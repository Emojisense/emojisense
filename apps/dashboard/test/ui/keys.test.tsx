import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { APP, FULL_KEY, KEY, me, NOW, stubApi, usage } from "./fake-api";

const usageRoute = { body: usage("2026-10") };

beforeEach(() => {
  window.history.replaceState(null, "", "/apps/app_1/keys");
});

describe("keys", () => {
  it("creates a key, shows it once, then lists only its prefix", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "POST /api/apps/app_1/keys": ({ body }) => ({
        status: 201,
        body: {
          key: { ...KEY, allowedOrigins: (body as { allowedOrigins: string[] }).allowedOrigins },
          fullKey: FULL_KEY,
        },
      }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create prod key" }));
    const form = await screen.findByRole("dialog", { name: "Create a production key" });
    fireEvent.change(within(form).getByLabelText("Allowed origins"), {
      target: { value: "https://chat.example.com\n https://*.example.org \n" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Create key" }));

    const reveal = await screen.findByRole("dialog", { name: "Copy your key now" });
    const field = within(reveal).getByLabelText("Your new publishable key") as HTMLInputElement;
    expect(field.value).toBe(FULL_KEY);
    expect(within(reveal).getByText("Shown once.")).toBeTruthy();
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/apps/app_1/keys",
      body: {
        kind: "publishable",
        environment: "prod",
        allowedOrigins: ["https://chat.example.com", "https://*.example.org"],
      },
    });

    fireEvent.click(within(reveal).getByRole("button", { name: "Copy key" }));
    expect(writeText).toHaveBeenCalledWith(FULL_KEY);
    expect(await within(reveal).findByText("Copied to the clipboard ✅")).toBeTruthy();

    fireEvent.click(within(reveal).getByRole("button", { name: "I have saved the key" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy your key now" })).toBeNull());
    expect(screen.getByRole("rowheader", { name: "pk_live_AbCd…" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(FULL_KEY);
  });

  it("sends no origins for a secret key", async () => {
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "POST /api/apps/app_1/keys": {
        status: 201,
        body: {
          key: { ...KEY, kind: "secret", prefix: "sk_live_WxYz", allowedOrigins: [] },
          fullKey: "sk_live_x",
        },
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create prod key" }));
    const form = await screen.findByRole("dialog", { name: "Create a production key" });
    fireEvent.click(within(form).getByRole("radio", { name: /Secret key/ }));
    expect(within(form).queryByLabelText("Allowed origins")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Create key" }));

    expect(await screen.findByLabelText("Your new secret key")).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      kind: "secret",
      environment: "prod",
    });
  });

  it("shows the origin error from the API inside the form", async () => {
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "POST /api/apps/app_1/keys": {
        status: 400,
        body: {
          error: {
            code: "invalid_origin",
            message: "Add at least one allowed origin. Only dev keys may allow any origin.",
            field: "allowedOrigins",
          },
        },
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create prod key" }));
    const form = await screen.findByRole("dialog", { name: "Create a production key" });
    fireEvent.click(within(form).getByRole("button", { name: "Create key" }));

    expect((await within(form).findByRole("alert")).textContent).toContain("Add at least one allowed origin");
    expect(within(form).getByLabelText("Allowed origins").getAttribute("aria-invalid")).toBe("true");
  });

  it("revokes a key only after confirmation", async () => {
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: { ...APP, activeKeyCount: 1 }, keys: [KEY] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "DELETE /api/keys/key_1": { body: { key: { ...KEY, revokedAt: NOW } } },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Revoke pk_live_AbCd…" }));
    let confirm = await screen.findByRole("dialog", { name: "Revoke this key?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Revoke this key?" })).toBeNull());
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Revoke pk_live_AbCd…" }));
    confirm = await screen.findByRole("dialog", { name: "Revoke this key?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke key" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Revoke pk_live_AbCd…" })).toBeNull());
    const row = screen.getByRole("row", { name: /pk_live_AbCd…/ });
    expect(within(row).getByText("Revoked", { selector: ".pill" })).toBeTruthy();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/keys/key_1" },
    ]);
  });

  it("edits the allowed origins of a publishable key", async () => {
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: { ...APP, activeKeyCount: 1 }, keys: [KEY] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "PATCH /api/keys/key_1": ({ body }) => ({ body: { key: { ...KEY, ...(body as object) } } }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit origins of pk_live_AbCd…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit allowed origins" });
    const field = within(dialog).getByLabelText("Allowed origins") as HTMLTextAreaElement;
    expect(field.value).toBe("https://chat.example.com");
    fireEvent.change(field, { target: { value: "https://new.example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save origins" }));

    expect(await screen.findByText("https://new.example.com")).toBeTruthy();
    expect(calls).toContainEqual({
      method: "PATCH",
      path: "/api/keys/key_1",
      body: { allowedOrigins: ["https://new.example.com"] },
    });
  });

  it("keeps each environment's keys in its own tab", async () => {
    const devKey = {
      ...KEY,
      id: "key_dev",
      environment: "dev" as const,
      prefix: "pk_live_D3vx",
      allowedOrigins: [],
    };
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": {
        body: { app: { ...APP, plan: "solo", activeKeyCount: 2 }, keys: [KEY, devKey] },
      },
      "GET /api/apps/app_1/usage": usageRoute,
    });
    render(<App />);

    expect(await screen.findByRole("rowheader", { name: "pk_live_AbCd…" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "pk_live_D3vx…" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Development/ }));
    expect(await screen.findByRole("rowheader", { name: "pk_live_D3vx…" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "pk_live_AbCd…" })).toBeNull();
    expect(window.location.search).toBe("?env=dev");
    expect(screen.getByText("Any origin")).toBeTruthy();
  });

  it("sends the tab's environment when a key is created there", async () => {
    const { calls } = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: { ...APP, plan: "solo" }, keys: [] } },
      "GET /api/apps/app_1/usage": usageRoute,
      "POST /api/apps/app_1/keys": {
        status: 201,
        body: { key: { ...KEY, environment: "dev", allowedOrigins: [] }, fullKey: FULL_KEY },
      },
    });
    window.history.replaceState(null, "", "/apps/app_1/keys?env=dev");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create dev key" }));
    const form = await screen.findByRole("dialog", { name: "Create a development key" });
    fireEvent.click(within(form).getByRole("button", { name: "Create key" }));

    await screen.findByRole("dialog", { name: "Copy your key now" });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      kind: "publishable",
      environment: "dev",
      allowedOrigins: [],
    });
  });

  it("shows a locked environment as a preview with its plan, and no create button", async () => {
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: APP, keys: [] } },
      "GET /api/apps/app_1/usage": usageRoute,
    });
    window.history.replaceState(null, "", "/apps/app_1/keys?env=staging");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Staging keys" })).toBeTruthy();
    expect(screen.getByText("Available on Pro and up")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade to Pro" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create .* key/ })).toBeNull();
    // The sample rows are out of reach: hidden from screen readers and inert.
    expect(screen.queryByRole("rowheader", { name: /pk_live_Stg/ })).toBeNull();
  });

  it("marks keys of an environment the plan lost as paused", async () => {
    const devKey = {
      ...KEY,
      id: "key_dev",
      environment: "dev" as const,
      prefix: "pk_live_D3vx",
      allowedOrigins: [],
    };
    stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps/app_1": { body: { app: { ...APP, activeKeyCount: 1 }, keys: [devKey] } },
      "GET /api/apps/app_1/usage": usageRoute,
    });
    window.history.replaceState(null, "", "/apps/app_1/keys?env=dev");
    render(<App />);

    const row = await screen.findByRole("row", { name: /pk_live_D3vx…/ });
    expect(within(row).getByText("Paused", { selector: ".pill" })).toBeTruthy();
    expect(screen.getByText(/These dev keys are paused/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade to Solo" })).toBeTruthy();
  });
});
