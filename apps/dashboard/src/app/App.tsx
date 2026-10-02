import { useCallback, useEffect, useMemo, useState } from "react";
import type { MeResponse } from "../shared/contract";
import { ApiError, api, errorMessage, UNAUTHORIZED_EVENT } from "./api";
import { Header } from "./components/Header";
import { AppPage } from "./pages/AppPage";
import { AppsPage } from "./pages/AppsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SignInPage } from "./pages/SignInPage";
import { navigate, usePath } from "./router";
import { type Session, SessionContext } from "./session";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: MeResponse }
  | { status: "error"; message: string };

const APP_PATH = /^\/apps\/([^/]+)\/?$/;

function decodeSegment(segment: string | undefined): string | null {
  try {
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

function Page({ path }: { path: string }) {
  if (path === "/" || path === "/apps" || path === "/apps/") return <AppsPage />;
  const appId = decodeSegment(APP_PATH.exec(path)?.[1]);
  if (appId) return <AppPage key={appId} appId={appId} />;
  return <NotFoundPage />;
}

export function App() {
  const path = usePath();
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

  useEffect(() => {
    if (auth.status === "signed-in" && path === "/") navigate("/apps", { replace: true });
  }, [auth.status, path]);

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
        setAuth({ status: "signed-out" });
        navigate("/", { replace: true });
      },
    };
  }, [auth, loadMe]);

  if (auth.status === "loading") {
    return (
      <p className="status-line" role="status">
        Loading the dashboard…
      </p>
    );
  }
  if (auth.status === "error") {
    return (
      <main className="page">
        <div className="notice notice-error" role="alert">
          <p>{auth.message}</p>
          <button type="button" className="button button-small" onClick={() => void loadMe()}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!session) return <SignInPage />;

  return (
    <SessionContext.Provider value={session}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="page" tabIndex={-1}>
        <Page path={path} />
      </main>
    </SessionContext.Provider>
  );
}
