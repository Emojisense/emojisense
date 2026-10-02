import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { APP, FULL_KEY, KEY, me, NOW, stubApi, usage } from "./fake-api";

const usageRoute = { body: usage("2026-10") };

beforeEach(() => {
  window.history.replaceState(null, "", "/apps/app_1");
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

    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    const form = await screen.findByRole("dialog", { name: "Create an API key" });
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
      body: { kind: "publishable", allowedOrigins: ["https://chat.example.com", "https://*.example.org"] },
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

    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    const form = await screen.findByRole("dialog", { name: "Create an API key" });
    fireEvent.click(within(form).getByRole("radio", { name: /Secret key/ }));
    expect(within(form).queryByLabelText("Allowed origins")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Create key" }));

    expect(await screen.findByLabelText("Your new secret key")).toBeTruthy();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ kind: "secret" });
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
            message: "Add at least one allowed origin. Only keys of dev apps may allow any origin.",
            field: "allowedOrigins",
          },
        },
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    const form = await screen.findByRole("dialog", { name: "Create an API key" });
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
});
