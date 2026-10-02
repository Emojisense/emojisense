import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, errorMessage, type Me, UNAUTHORIZED_EVENT } from "./api";
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
import { SignInPage } from "./pages/SignInPage";
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

  const loadMe = useCallback(async () => {
    try {
      setAuth({ status: "signed-in", me: await api.me() });
    } catch (error) {
      setAuth(
        error instanceof ApiError && error.status === 401
          ? { status: "signed-out" }
          : { status: "error", message: errorMessage(error) },
      );
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Any 401 (an expired session, a sign-out in another tab) returns to the sign-in page.
  useEffect(() => {
    const onUnauthorized = () => setAuth({ status: "signed-out" });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

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
      signOut: async () => {
        await api.logout().catch(() => undefined);
        forgetPendingInvite();
        setAuth({ status: "signed-out" });
        navigate("/", { replace: true });
      },
    };
  }, [auth, loadMe]);

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
