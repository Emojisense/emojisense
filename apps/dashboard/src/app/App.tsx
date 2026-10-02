import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, api, errorMessage, type Me, UNAUTHORIZED_EVENT } from "./api";
import { useAuthAdapter } from "./auth/context";
import { forgetPendingInvite, pendingInvite, rememberPendingInvite } from "./lib/pendingInvite";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AppsPage } from "./pages/AppsPage";
import { BillingPage } from "./pages/BillingPage";
import { EmojiPage } from "./pages/EmojiPage";
import { EmojiSetsPage } from "./pages/EmojiSetsPage";
import { InvitePage } from "./pages/InvitePage";
import { KeysPage } from "./pages/KeysPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionRejectedPage, SignInPage } from "./pages/SignInPage";
import { TeamPage } from "./pages/TeamPage";
import { TenantsPage } from "./pages/TenantsPage";
import { WebhooksPage } from "./pages/WebhooksPage";
import { navigate, usePath } from "./router";
import { type AppSection, parseRoute, type Route } from "./routes";
import { type Session, SessionContext } from "./session";
import { AppShell } from "./shell/AppShell";
import { AppScope, AppsProvider, useAppScope } from "./shell/context";
import { ErrorState, LoadingState } from "./ui/Feedback";
import { ToastProvider } from "./ui/Toast";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: Me }
  /** Clerk has a session, but the API does not accept it (a setup problem, or a deleted account). */
  | { status: "rejected"; message?: string }
  | { status: "error"; message: string };

const SECTION_PAGES: Record<AppSection, ComponentType> = {
  overview: OverviewPage,
  keys: KeysPage,
  emoji: EmojiPage,
  analytics: AnalyticsPage,
  "emoji-sets": EmojiSetsPage,
  tenants: TenantsPage,
  webhooks: WebhooksPage,
};

/** An app section, once the app has loaded. A missing or foreign app reads as not found. */
function AppSectionPage({ section }: { section: AppSection }) {
  const { detail, reload } = useAppScope();
  if (detail.status === "loading") return <LoadingState label="Loading app…" rows={4} />;
  if (detail.status === "error") {
    return detail.httpStatus === 404 ? (
      <NotFoundPage title="App not found">
        This app does not exist, or it belongs to another account.
      </NotFoundPage>
    ) : (
      <ErrorState message={detail.message} onRetry={reload} />
    );
  }
  if (detail.status === "plan") return null;
  const Section = SECTION_PAGES[section];
  return <Section />;
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "apps":
      return <AppsPage />;
    case "app":
      return <AppSectionPage section={route.section} />;
    case "team":
      return <TeamPage />;
    case "billing":
      return <BillingPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <NotFoundPage />;
  }
}

export function App() {
  const path = usePath();
  const route = parseRoute(path);
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const provider = useAuthAdapter();
  const providerUser = useRef(provider.userId);
  useLayoutEffect(() => {
    providerUser.current = provider.userId;
  }, [provider.userId]);

  /** A 401 with a Clerk session is a problem to show; without one it means "signed out". */
  const unauthorized = useCallback(
    (): AuthState => (providerUser.current ? { status: "rejected" } : { status: "signed-out" }),
    [],
  );

  const loadMe = useCallback(async () => {
    try {
      setAuth({ status: "signed-in", me: await api.me() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuth(unauthorized());
      // Signed in with Clerk, but without a verified email: only signing out helps.
      else if (error instanceof ApiError && error.code === "email_required")
        setAuth({ status: "rejected", message: error.message });
      else setAuth({ status: "error", message: errorMessage(error) });
    }
  }, [unauthorized]);

  // Ask the API who is signed in once Clerk has loaded, and again when Clerk's user changes.
  // Without Clerk, the dev sign-in cookie decides.
  const sessionKey = provider.loaded ? (provider.userId ?? "no-clerk-session") : null;
  useEffect(() => {
    if (sessionKey === null) return;
    setAuth({ status: "loading" });
    void loadMe();
  }, [sessionKey, loadMe]);

  // Any 401 (an ended session, a sign-out in another tab) returns to the sign-in page.
  useEffect(() => {
    const onUnauthorized = () => setAuth(unauthorized());
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [unauthorized]);

  const signOut = useCallback(async () => {
    // Clears the dev sign-in cookie, then ends the Clerk session.
    await api.logout().catch(() => undefined);
    const ended = await provider.signOut().then(
      () => true,
      () => false,
    );
    forgetPendingInvite();
    // If Clerk kept the session, the sign-in form would face a signed-in user: offer sign-out again.
    setAuth(ended ? { status: "signed-out" } : { status: "rejected" });
    navigate("/", { replace: true });
  }, [provider]);

  // After sign-in, "/" goes to the apps, or back to an invite opened while signed out.
  useEffect(() => {
    if (auth.status !== "signed-in" || path !== "/") return;
    const invite = pendingInvite();
    navigate(invite ? `/invite/${encodeURIComponent(invite)}` : "/apps", { replace: true });
  }, [auth.status, path]);

  useEffect(() => {
    if (auth.status === "signed-out" && route.name === "invite") rememberPendingInvite(route.token);
  }, [auth.status, route]);

  const session = useMemo<Session | null>(() => {
    if (auth.status !== "signed-in") return null;
    return {
      me: auth.me,
      refresh: loadMe,
      update: (change) =>
        setAuth((current) =>
          current.status === "signed-in" ? { ...current, me: change(current.me) } : current,
        ),
      signOut,
    };
  }, [auth, loadMe, signOut]);

  if (provider.failed) {
    return (
      <main className="boot">
        <ErrorState
          message="The sign-in service did not load. Check your connection or a content blocker, then try again."
          onRetry={() => window.location.reload()}
        />
      </main>
    );
  }
  if (auth.status === "loading") {
    return (
      <div className="boot" role="status">
        <span className="emoji boot-glyph" aria-hidden="true">
          🦖
        </span>
        <span className="visually-hidden">Loading the dashboard…</span>
      </div>
    );
  }
  if (auth.status === "rejected") {
    return (
      <SessionRejectedPage
        message={auth.message}
        onRetry={() => void loadMe()}
        onSignOut={() => void signOut()}
      />
    );
  }
  if (auth.status === "error") {
    return (
      <main className="boot">
        <ErrorState message={auth.message} onRetry={() => void loadMe()} />
      </main>
    );
  }
  if (!session) return <SignInPage invite={route.name === "invite"} />;

  return (
    <SessionContext.Provider value={session}>
      <ToastProvider>
        {route.name === "invite" ? (
          <InvitePage token={route.token} />
        ) : (
          <AppsProvider>
            <AppScope appId={route.name === "app" ? route.appId : null}>
              <AppShell route={route}>
                <Page route={route} />
              </AppShell>
            </AppScope>
          </AppsProvider>
        )}
      </ToastProvider>
    </SessionContext.Provider>
  );
}
