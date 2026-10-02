import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../src/options/options.html?raw";
import { describeResponse, initOptions, type OptionsDeps, testConnection } from "../src/options/page";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";
import { flush } from "./fixture";

function load(settings: Partial<Settings> = {}) {
  // Body only: the head's stylesheet and script would make happy-dom try to fetch them.
  const page = new DOMParser().parseFromString(html.slice(html.indexOf("<body")), "text/html");
  document.body.replaceChildren(...page.body.childNodes);
  const saveSettings = vi.fn(async (_settings: Settings) => undefined);
  const deps: OptionsDeps = {
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    saveSettings,
    shortcut: async () => "⇧⌘Space",
    openShortcutSettings: vi.fn(),
    origin: "chrome-extension://abcdefghijklmnop",
    platform: "Win32",
    fetch: vi.fn(async () => new Response(JSON.stringify({ results: [] }))),
  };
  return { deps, saveSettings };
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function change(element: HTMLInputElement | HTMLSelectElement, value?: string | boolean): void {
  if (typeof value === "boolean") (element as HTMLInputElement).checked = value;
  else if (value !== undefined) element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("options page", () => {
  let ctx: ReturnType<typeof load>;

  beforeEach(async () => {
    ctx = load();
    await initOptions(document, ctx.deps);
  });

  it("shows the shortcut, the origin to allow, and the paste key for this platform", () => {
    expect(byId("shortcut").textContent).toBe("⇧⌘Space");
    expect(byId("origin").textContent).toBe("chrome-extension://abcdefghijklmnop");
    expect(document.querySelector(".paste-key")?.textContent).toBe("Ctrl+V");
    byId("change-shortcut").click();
    expect(ctx.deps.openShortcutSettings).toHaveBeenCalled();
  });

  it("starts with search by meaning off and its fields hidden", () => {
    expect(byId<HTMLInputElement>("semantic-enabled").checked).toBe(false);
    expect(byId("semantic-fields").hidden).toBe(true);
    expect(byId<HTMLInputElement>("docs-direct").checked).toBe(false);
  });

  it("saves the language and the skin tone", async () => {
    change(byId<HTMLSelectElement>("locale"), "tr");
    const medium = document.querySelector<HTMLInputElement>('input[name="skin-tone"][value="medium"]');
    if (!medium) throw new Error("no skin tone option");
    change(medium, true);
    await flush();
    expect(ctx.saveSettings).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      locale: "tr",
      skinTone: "medium",
    });
  });

  it("validates the endpoint and refuses secret keys with a visible, linked error", async () => {
    change(byId<HTMLInputElement>("semantic-enabled"), true);
    expect(byId("semantic-fields").hidden).toBe(false);

    const endpoint = byId<HTMLInputElement>("endpoint");
    change(endpoint, "http://api.example.com");
    expect(endpoint.getAttribute("aria-invalid")).toBe("true");
    expect(byId("endpoint-error").hidden).toBe(false);
    change(endpoint, "https://api.example.com/");
    expect(endpoint.value).toBe("https://api.example.com");
    expect(endpoint.hasAttribute("aria-invalid")).toBe(false);

    const key = byId<HTMLInputElement>("key");
    change(key, "sk_live_12345678");
    expect(byId("key-error").textContent).toContain("secret key");
    expect(key.getAttribute("aria-describedby")).toContain("key-error");
    await flush();

    const last = ctx.saveSettings.mock.calls.at(-1)?.[0];
    expect(last?.semantic).toEqual({ enabled: true, endpoint: "https://api.example.com", key: "" });
  });

  it("tests the connection with one search request", async () => {
    change(byId<HTMLInputElement>("semantic-enabled"), true);
    change(byId<HTMLInputElement>("endpoint"), "https://api.example.com");
    change(byId<HTMLInputElement>("key"), "pk_live_12345678");
    await flush();
    byId<HTMLButtonElement>("test-connection").click();
    await flush();
    await flush();

    const url = new URL(String(vi.mocked(ctx.deps.fetch).mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("key")).toBe("pk_live_12345678");
    expect(byId("test-result").textContent).toBe("Connected ✓");
  });
});

describe("connection test messages", () => {
  it("explains the API's answers", () => {
    expect(describeResponse(200, {})).toEqual({ ok: true, message: "Connected ✓" });
    expect(describeResponse(200, { overLimit: true }).message).toContain("monthly limit");
    expect(describeResponse(403, {}).message).toContain("allowed origin");
    expect(describeResponse(401, {}).message).toContain("revoked");
    expect(describeResponse(500, {})).toEqual({ ok: false, message: "The API answered with HTTP 500." });
  });

  it("explains a network failure", async () => {
    const outcome = await testConnection({ endpoint: "https://api.example.com", key: "" }, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Could not reach");
  });
});
