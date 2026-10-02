/**
 * The SPA with Clerk mocked: @clerk/react is replaced by a small controllable fake, so the tests
 * cover the app's side (provider, bearer token, sign-in screen, sign-out, account deletion).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { ClerkAuth } from "../../src/app/auth/ClerkAuth";
import { APP, me, stubApi, unauthorized } from "./fake-api";

const clerk = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const statusListeners = new Set<(status: string) => void>();
  const state = {
    isLoaded: true,
    userId: null as string | null,
    version: 0,
    providerProps: {} as Record<string, unknown>,
    deleteSelfEnabled: true,
    status: "ready",
    deleteUser: async () => {},
    openUserProfile: () => {},
  };
  const notify = () => {
    state.version += 1;
    for (const listener of listeners) listener();
  };
  return {
    state,
    listeners,
    statusListeners,
    setStatus(status: string) {
      state.status = status;
      for (const listener of statusListeners) listener(status);
    },
    setUser(userId: string | null) {
      state.userId = userId;
      notify();
    },
    signOut: async () => {
      state.userId = null;
      notify();
    },
  };
});

vi.mock("@clerk/react", async () => {
  const { createElement, Fragment, useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    clerk.listeners.add(listener);
    return () => clerk.listeners.delete(listener);
  };
  return {
    ClerkProvider: ({ children, ...props }: { children: unknown } & Record<string, unknown>) => {
      clerk.state.providerProps = props;
      return createElement(Fragment, null, children as never);
    },
    useAuth: () => {
      useSyncExternalStore(subscribe, () => clerk.state.version);
      return {
        isLoaded: clerk.state.isLoaded,
        userId: clerk.state.userId,
        getToken: async () => (clerk.state.userId ? `token-for-${clerk.state.userId}` : null),
        signOut: () => clerk.signOut(),
      };
    },
    useClerk: () => ({
      status: clerk.state.status,
      on: (_event: string, listener: (status: string) => void, options?: { notify?: boolean }) => {
        clerk.statusListeners.add(listener);
        if (options?.notify) listener(clerk.state.status);
      },
      off: (_event: string, listener: (status: string) => void) => clerk.statusListeners.delete(listener),
      user: clerk.state.userId
        ? { deleteSelfEnabled: clerk.state.deleteSelfEnabled, delete: () => clerk.state.deleteUser() }
        : null,
      openUserProfile: () => clerk.state.openUserProfile(),
    }),
    SignIn: (props: Record<string, unknown>) =>
      createElement("div", { "data-testid": "clerk-sign-in", "data-routing": props.routing }),
  };
});

const KEY = "pk_test_ZmVhc2libGUtYmxvd2Zpc2gtOTY4MC5jbGVyay5hY2NvdW50cy5kZXYk";

function renderWithClerk() {
  return render(
    <ClerkAuth publishableKey={KEY}>
      <App />
    </ClerkAuth>,
  );
}

beforeEach(() => {
  clerk.state.isLoaded = true;
  clerk.state.userId = null;
  clerk.state.status = "ready";
  clerk.state.deleteSelfEnabled = true;
  clerk.state.deleteUser = vi.fn(async () => {});
  clerk.state.openUserProfile = vi.fn();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("Clerk sign-in", () => {
  it("passes the publishable key and turns telemetry off", () => {
    stubApi({ "GET /api/me": unauthorized });
    renderWithClerk();
    expect(clerk.state.providerProps).toMatchObject({
      publishableKey: KEY,
      telemetry: false,
      signInUrl: "/",
      signUpUrl: "/",
      afterSignOutUrl: "/",
      signInForceRedirectUrl: "/",
      signUpForceRedirectUrl: "/",
    });
  });

  it("waits for Clerk, then shows Clerk's sign-in when signed out", async () => {
    clerk.state.isLoaded = false;
    const { calls } = stubApi({ "GET /api/me": unauthorized });
    renderWithClerk();
    expect(screen.getByRole("status").textContent).toContain("Loading the dashboard");
    expect(calls).toEqual([]);

    act(() => {
      clerk.state.isLoaded = true;
      clerk.setUser(null);
    });
    const form = await screen.findByTestId("clerk-sign-in");
    expect(form.getAttribute("data-routing")).toBe("hash");
    // Signed out, so no bearer token; localhost still offers the dev sign-in.
    expect(calls).toEqual([{ method: "GET", path: "/api/me" }]);
    expect(screen.getByRole("button", { name: "Sign in as dev user" })).toBeTruthy();
  });

  it("says so when Clerk's scripts do not load", async () => {
    clerk.state.isLoaded = false;
    clerk.state.status = "loading";
    const { calls } = stubApi({ "GET /api/me": unauthorized });
    renderWithClerk();
    expect(screen.getByRole("status").textContent).toContain("Loading the dashboard");
    act(() => clerk.setStatus("error"));
    expect((await screen.findByRole("alert")).textContent).toContain("The sign-in service did not load");
    expect(calls).toEqual([]);
  });

  it("sends the Clerk session token with every API call after sign-in", async () => {
    window.history.replaceState(null, "", "/apps");
    let signedIn = false;
    const { calls } = stubApi({
      "GET /api/me": () => (signedIn ? { body: me() } : unauthorized),
      "GET /api/apps": { body: { apps: [APP] } },
    });
    renderWithClerk();
    await screen.findByTestId("clerk-sign-in");

    signedIn = true;
    act(() => clerk.setUser("user_ada"));
    expect(await screen.findByRole("heading", { name: "Apps" })).toBeTruthy();
    const authed = calls.filter((call) => call.authorization);
    expect(authed.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /api/me", "GET /api/apps"]);
    expect(new Set(authed.map((call) => call.authorization))).toEqual(new Set(["Bearer token-for-user_ada"]));
  });

  it("asks for a verified email when the API needs one", async () => {
    clerk.state.userId = "user_ada";
    stubApi({
      "GET /api/me": {
        status: 403,
        body: { error: { code: "email_required", message: "The dashboard needs a verified email address." } },
      },
    });
    renderWithClerk();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The dashboard needs a verified email address.",
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("explains a session the API does not accept, and signs out from there", async () => {
    clerk.state.userId = "user_ada";
    stubApi({ "GET /api/me": unauthorized, "POST /api/auth/logout": { body: { ok: true } } });
    renderWithClerk();

    expect(await screen.findByRole("heading", { name: "We could not open your account" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByTestId("clerk-sign-in")).toBeTruthy();
    expect(clerk.state.userId).toBeNull();
  });
});

describe("signed in with Clerk", () => {
  function renderSettings(deleted: { clerkUserDeleted: boolean }) {
    clerk.state.userId = "user_ada";
    window.history.replaceState(null, "", "/settings");
    const api = stubApi({
      "GET /api/me": () => (clerk.state.userId ? { body: me() } : unauthorized),
      "GET /api/apps": { body: { apps: [APP] } },
      "DELETE /api/me": { body: { ok: true, ...deleted } },
      "POST /api/auth/logout": { body: { ok: true } },
    });
    renderWithClerk();
    return api;
  }

  async function deleteAccount() {
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "ada@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));
    return dialog;
  }

  it("names Clerk as the sign-in and opens Clerk's profile", async () => {
    renderSettings({ clerkUserDeleted: false });
    expect(await screen.findByText(/Email or social sign-in through Clerk/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage sign-in" }));
    expect(clerk.state.openUserProfile).toHaveBeenCalledOnce();
  });

  it("signs out through Clerk", async () => {
    renderSettings({ clerkUserDeleted: false });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByTestId("clerk-sign-in")).toBeTruthy();
    expect(clerk.state.userId).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("deletes the Clerk user with Clerk JS after the account, then signs out", async () => {
    const { calls } = renderSettings({ clerkUserDeleted: false });
    await deleteAccount();
    expect(await screen.findByTestId("clerk-sign-in")).toBeTruthy();
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", path: "/api/me" }));
    expect(clerk.state.deleteUser).toHaveBeenCalledOnce();
  });

  it("leaves the Clerk user alone when the Worker already deleted it", async () => {
    renderSettings({ clerkUserDeleted: true });
    await deleteAccount();
    expect(await screen.findByTestId("clerk-sign-in")).toBeTruthy();
    expect(clerk.state.deleteUser).not.toHaveBeenCalled();
  });

  it("says so when Clerk keeps the sign-in profile", async () => {
    clerk.state.deleteSelfEnabled = false;
    renderSettings({ clerkUserDeleted: false });
    const dialog = await deleteAccount();
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Your sign-in profile at Clerk (name and email) could not be deleted",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByTestId("clerk-sign-in")).toBeTruthy();
  });
});
