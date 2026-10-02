import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { APP, me, stubApi, unauthorized, usage } from "./fake-api";

describe("sign-in", () => {
  it("offers GitHub sign-in and explains a failed callback", async () => {
    window.history.replaceState(null, "", "/?error=github_state");
    stubApi({ "GET /api/me": unauthorized });
    render(<App />);

    const github = await screen.findByRole("link", { name: "Sign in with GitHub" });
    expect(github.getAttribute("href")).toBe("/api/auth/github");
    expect(screen.getByRole("alert").textContent).toBe(
      "The sign-in expired or started in another tab. Try again.",
    );
    // The test page runs on localhost, so the dev sign-in form is shown.
    expect(screen.getByRole("button", { name: "Sign in as dev user" })).toBeTruthy();
  });
});

describe("apps page", () => {
  it("shows an empty state and opens the new app after creating it", async () => {
    window.history.replaceState(null, "", "/apps");
    const { calls } = stubApi({
      "GET /api/me": { body: me({ appCount: 0 }) },
      "GET /api/apps": { body: { apps: [] } },
      "POST /api/apps": ({ body }) => ({
        status: 201,
        body: { app: { ...APP, ...(body as object) } },
      }),
      "GET /api/apps/app_1": { body: { app: { ...APP, environment: "dev" }, keys: [] } },
      "GET /api/apps/app_1/usage": ({ url }) => ({ body: usage(url.searchParams.get("period") ?? "") }),
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "No apps yet" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("App name"), { target: { value: "Chat app" } });
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Create app" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Chat app" })).toBeTruthy();
    expect(window.location.pathname).toBe("/apps/app_1");
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/apps",
      body: { name: "Chat app", environment: "dev" },
    });
    expect(screen.getByRole("heading", { name: "No keys yet" })).toBeTruthy();
  });

  it("shows a server error next to the form", async () => {
    window.history.replaceState(null, "", "/apps");
    stubApi({
      "GET /api/me": { body: me({ appCount: 0 }) },
      "GET /api/apps": { body: { apps: [] } },
      "POST /api/apps": {
        status: 400,
        body: { error: { code: "invalid_request", message: "name cannot be empty.", field: "name" } },
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create app" }));
    expect((await screen.findByRole("alert")).textContent).toBe("name cannot be empty.");
    expect(screen.getByLabelText("App name").getAttribute("aria-invalid")).toBe("true");
  });

  it("explains the plan limit and joins the waitlist of the plan with more apps", async () => {
    window.history.replaceState(null, "", "/apps");
    const { calls } = stubApi({
      "GET /api/me": { body: me({ appCount: 1 }) },
      "GET /api/apps": { body: { apps: [APP] } },
      "POST /api/billing/upgrade": ({ body }) => ({
        body: { status: "waitlist", plan: (body as { plan: string }).plan },
      }),
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Chat app" })).toBeTruthy();
    const gate = screen.getByRole("region", { name: "More apps with Pro" });
    expect(gate.textContent).toContain("apps are all in use");
    expect((screen.getByRole("button", { name: "New app" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(gate).getByRole("button", { name: "Upgrade to Pro" }));
    expect(await within(gate).findByText(/You are on the Pro waitlist/)).toBeTruthy();
    expect(
      (within(gate).getByRole("button", { name: "On the waitlist" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(calls).toContainEqual({ method: "POST", path: "/api/billing/upgrade", body: { plan: "pro" } });
  });

  it("offers the plan with more apps when the API answers 402", async () => {
    window.history.replaceState(null, "", "/apps");
    stubApi({
      "GET /api/me": { body: me({ appCount: 0 }) },
      "GET /api/apps": { body: { apps: [] } },
      "POST /api/apps": {
        status: 402,
        body: { error: { code: "plan_required", message: "Your Free plan allows 1 app.", plan: "pro" } },
      },
    });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("App name"), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Create app" }));

    const gate = await screen.findByRole("region", { name: "More apps with Pro" });
    expect(within(gate).getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
    // A plan gate is an invitation, never an error.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("settings page", () => {
  function renderSettings(deleteRoute: Parameters<typeof stubApi>[0][string]) {
    window.history.replaceState(null, "", "/settings");
    const api = stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [APP] } },
      "DELETE /api/me": deleteRoute,
      "POST /api/auth/logout": { body: { ok: true } },
    });
    render(<App />);
    return api;
  }

  async function openDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    const input = within(dialog).getByLabelText(/to confirm/) as HTMLInputElement;
    const submit = within(dialog).getByRole("button", { name: "Delete account" }) as HTMLButtonElement;
    return { dialog, input, submit };
  }

  it("deletes the account only after the email is typed, then shows the sign-in page", async () => {
    const { calls } = renderSettings({ body: { ok: true } });
    const { input, submit } = await openDialog();
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "someone@example.com" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " ADA@example.com " } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeTruthy();
    expect(calls).toContainEqual({ method: "DELETE", path: "/api/me", body: { confirm: "ADA@example.com" } });
    expect(window.location.pathname).toBe("/");
  });

  it("keeps the dialog open and shows the server's message when the deletion fails", async () => {
    renderSettings({
      status: 503,
      body: { error: { code: "storage_unavailable", message: "Your account was not deleted. Try again." } },
    });
    const { dialog, input, submit } = await openDialog();
    fireEvent.change(input, { target: { value: "ada@example.com" } });
    fireEvent.click(submit);

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Your account was not deleted. Try again.",
    );
    expect(screen.queryByRole("link", { name: "Sign in with GitHub" })).toBeNull();
  });
});
