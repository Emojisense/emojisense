import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Registers <emojisense-picker>.
import "../src/index.js";
import type { EmojiSelectDetail, EmojisensePickerElement } from "../src/index.js";
import { custom, en, PACK_URL, PARROT_URL, serve } from "./fixture.js";

let fetch: ReturnType<typeof serve>;

beforeEach(() => {
  fetch = serve();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(attributes: Record<string, string>, packs?: (typeof en)[]) {
  const picker = document.createElement("emojisense-picker") as EmojisensePickerElement;
  for (const [name, value] of Object.entries(attributes)) picker.setAttribute(name, value);
  if (packs) picker.packs = packs;
  document.body.append(picker);
  await vi.waitFor(() => expect(picker.status).toBe("ready"));
  return picker;
}

const $$ = (picker: EmojisensePickerElement, selector: string) => [
  ...(picker.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []),
];
const input = (picker: EmojisensePickerElement) =>
  picker.shadowRoot?.querySelector("input") as HTMLInputElement;

function type(picker: EmojisensePickerElement, value: string) {
  input(picker).value = value;
  input(picker).dispatchEvent(new Event("input"));
}

function press(picker: EmojisensePickerElement, key: string) {
  input(picker).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function selections() {
  const details: EmojiSelectDetail[] = [];
  document.addEventListener("emoji-select", (event) => details.push(event.detail));
  return details;
}

const parrotImages = (picker: EmojisensePickerElement, scope: string) =>
  $$(picker, `${scope} img`).filter((img) => img.getAttribute("src") === PARROT_URL) as HTMLImageElement[];

describe("<emojisense-picker> custom emoji", () => {
  it("browses custom emoji in their own group, drawn as images", async () => {
    const picker = await mount({}, [en, custom]);
    const labels = $$(picker, ".group-label").map((label) => label.textContent);
    expect(labels.at(-1)).toBe("Custom");
    const [image] = parrotImages(picker, "#browse");
    expect(image?.alt).toBe(":party_parrot:");
    expect(image?.getAttribute("part")).toBe("image");
    expect(image?.closest("[role=option]")?.getAttribute("aria-label")).toBe(":party_parrot:");
  });

  it("ranks custom emoji while typing and selects them with imageUrl and shortcode", async () => {
    const picker = await mount({ "emoji-set": "twemoji", endpoint: "https://api.test" }, [en, custom]);
    const selected = selections();
    type(picker, "party parrot");
    expect(parrotImages(picker, "#results")).toHaveLength(1);
    press(picker, "Enter");
    expect(selected).toEqual([
      {
        emoji: ":party_parrot:",
        label: ":party_parrot:",
        id: "C-e1",
        imageUrl: PARROT_URL,
        shortcode: "party_parrot",
      },
    ]);
  });

  it("loads the key's custom pack with custom-emoji, endpoint and key", async () => {
    const picker = await mount({
      "pack-url": PACK_URL,
      endpoint: "https://api.test",
      key: "pk_test_1",
      tenant: "acme",
      "custom-emoji": "",
    });
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      "https://api.test/v1/custom-pack?key=pk_test_1&tenant=acme",
    );
    await vi.waitFor(() => expect(parrotImages(picker, "#browse")).toHaveLength(1));
    type(picker, "celebrate");
    expect(parrotImages(picker, "#results")).toHaveLength(1);

    picker.customEmoji = false;
    await vi.waitFor(() => expect(parrotImages(picker, "#browse")).toHaveLength(0));
  });

  it("asks for no custom pack without the attribute, and keeps working when it fails", async () => {
    await mount({ "pack-url": PACK_URL, endpoint: "https://api.test", key: "pk_test_1" });
    expect(fetch.mock.calls.some(([url]) => String(url).includes("custom-pack"))).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("custom-pack") ? new Response("{}", { status: 401 }) : fetch(url),
      ),
    );
    const picker = await mount({
      "pack-url": PACK_URL,
      endpoint: "https://api.test",
      key: "pk_test_1",
      "custom-emoji": "",
    });
    type(picker, "jurassic");
    expect($$(picker, "#results [role=option]")[0]?.textContent).toBe("🦖");
  });

  it("draws a custom result from the API as an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("/v1/search")
          ? Response.json({
              results: [
                {
                  emoji: ":shipit:",
                  id: "C-e9",
                  score: 0.9,
                  source: "custom",
                  imageUrl: "https://api.test/v1/custom/app1/e9",
                  shortcode: "shipit",
                },
              ],
              packVersion: "test",
              cached: false,
            })
          : fetch(url),
      ),
    );
    const picker = await mount({ "pack-url": PACK_URL, endpoint: "https://api.test", key: "pk_test_1" });
    type(picker, "a squirrel with a hat");
    await vi.waitFor(() =>
      expect($$(picker, "#results img").map((img) => img.getAttribute("alt"))).toContain(":shipit:"),
    );
  });
});
