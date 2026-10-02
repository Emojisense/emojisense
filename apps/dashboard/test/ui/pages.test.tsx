import { fireEvent, render, screen } from "@testing-library/react";
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

  it("explains the plan limit and joins the Pro waitlist", async () => {
    window.history.replaceState(null, "", "/apps");
    const { calls } = stubApi({
      "GET /api/me": { body: me({ appCount: 1 }) },
      "GET /api/apps": { body: { apps: [APP] } },
      "POST /api/waitlist": ({ body }) => ({ body: { ok: true, plan: (body as { plan: string }).plan } }),
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Chat app" })).toBeTruthy();
    expect(screen.getByText(/you use all of them/).textContent).toContain("join its waitlist");
    expect(screen.queryByRole("button", { name: "Create app" })).toBeNull();

    const email = screen.getByLabelText("Email for the waitlist") as HTMLInputElement;
    expect(email.value).toBe("ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Join the Pro waitlist" }));
    expect(await screen.findByText(/You are on the Pro waitlist/)).toBeTruthy();
    expect(screen.queryByLabelText("Email for the waitlist")).toBeNull();
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/waitlist",
      body: { email: "ada@example.com", plan: "pro" },
    });
  });
});
