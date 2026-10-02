import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import type { KeySummary } from "../../shared/contract";
import { type App, api } from "../api";
import { type Resource, useResource } from "../lib/useResource";

/* All apps, for the switcher and the apps page. */

interface AppsValue {
  apps: Resource<App[]>;
  reload: () => void;
  upsert: (app: App) => void;
}

const AppsContext = createContext<AppsValue | null>(null);

export function AppsProvider({ children }: { children: ReactNode }) {
  const [apps, { reload, mutate }] = useResource("apps", () => api.listApps().then((data) => data.apps));
  const upsert = useCallback(
    (app: App) =>
      mutate((list) =>
        list.some((item) => item.id === app.id)
          ? list.map((item) => (item.id === app.id ? { ...item, ...app } : item))
          : [...list, app],
      ),
    [mutate],
  );
  const value = useMemo(() => ({ apps, reload, upsert }), [apps, reload, upsert]);
  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export function useApps(): AppsValue {
  const value = useContext(AppsContext);
  if (!value) throw new Error("useApps must be used inside AppsProvider");
  return value;
}

/* The app of the current route, with its keys. */

export interface AppDetail {
  app: App;
  keys: KeySummary[];
}

interface AppScopeValue {
  appId: string | null;
  detail: Resource<AppDetail>;
  reload: () => void;
  setApp: (app: App) => void;
  setKeys: (keys: KeySummary[]) => void;
}

const AppScopeContext = createContext<AppScopeValue>({
  appId: null,
  detail: { status: "loading" },
  reload: () => undefined,
  setApp: () => undefined,
  setKeys: () => undefined,
});

const LAST_APP_KEY = "emojisense:last-app";

export function lastAppId(): string | null {
  try {
    return localStorage.getItem(LAST_APP_KEY);
  } catch {
    return null;
  }
}

export function AppScope({ appId, children }: { appId: string | null; children: ReactNode }) {
  const { upsert } = useApps();
  const [detail, { reload, mutate }] = useResource<AppDetail>(`app:${appId ?? ""}`, () =>
    appId ? api.getApp(appId) : Promise.reject(new Error("No app selected.")),
  );

  useEffect(() => {
    if (!appId || detail.status !== "ready") return;
    try {
      localStorage.setItem(LAST_APP_KEY, appId);
    } catch {
      // Private mode: the sidebar falls back to the first app.
    }
  }, [appId, detail.status]);

  const setApp = useCallback(
    (app: App) => {
      mutate((current) => ({ ...current, app: { ...current.app, ...app } }));
      upsert(app);
    },
    [mutate, upsert],
  );

  const setKeys = useCallback(
    (keys: KeySummary[]) =>
      mutate((current) => ({
        keys,
        app: { ...current.app, activeKeyCount: keys.filter((key) => key.revokedAt === null).length },
      })),
    [mutate],
  );

  const value = useMemo(
    () => ({ appId, detail, reload, setApp, setKeys }),
    [appId, detail, reload, setApp, setKeys],
  );
  return <AppScopeContext.Provider value={value}>{children}</AppScopeContext.Provider>;
}

export function useAppScope(): AppScopeValue {
  return useContext(AppScopeContext);
}

/** For pages inside a loaded app: the app, its keys and the caller's rights. */
export function useAppDetail() {
  const { detail, setApp, setKeys, reload } = useAppScope();
  if (detail.status !== "ready") throw new Error("useAppDetail needs a loaded app");
  const { role } = detail.data.app;
  return {
    app: detail.data.app,
    keys: detail.data.keys,
    role,
    /** Viewers read; developers and up may change the app (docs/API.md, "Roles"). */
    readOnly: role === "viewer",
    setApp,
    setKeys,
    reload,
  };
}
