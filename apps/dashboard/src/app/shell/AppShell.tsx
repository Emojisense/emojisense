import { type ReactNode, useEffect, useRef, useState } from "react";
import type { App } from "../api";
import { DOCS_URL } from "../lib/config";
import { appEmoji } from "../lib/identity";
import { Link, usePath } from "../router";
import { appHref, type Route, SECTION_INFO } from "../routes";
import { Icon } from "../ui/Icon";
import { lastAppId, useAppScope, useApps } from "./context";
import { Sidebar } from "./Sidebar";

/** The app the sidebar is about: the route's app, else the last one opened, else the first. */
function useCurrentApp(route: Route): App | null {
  const { apps } = useApps();
  const { detail } = useAppScope();
  const list = apps.status === "ready" ? apps.data : [];
  if (route.name === "app") {
    if (detail.status === "ready") return detail.data.app;
    return list.find((app) => app.id === route.appId) ?? null;
  }
  const last = lastAppId();
  return list.find((app) => app.id === last) ?? list[0] ?? null;
}

interface Crumb {
  label: ReactNode;
  to?: string;
}

function crumbsFor(route: Route, app: App | null): Crumb[] {
  switch (route.name) {
    case "apps":
      return [{ label: "Apps" }];
    case "app": {
      const appCrumb: Crumb = {
        to: appHref(route.appId),
        label: (
          <span className="crumb-app">
            <span className="emoji" aria-hidden="true">
              {appEmoji(route.appId)}
            </span>
            {app?.name ?? "App"}
          </span>
        ),
      };
      return [{ label: "Apps", to: "/apps" }, appCrumb, { label: SECTION_INFO[route.section].label }];
    }
    case "team":
      return [{ label: "Account" }, { label: "Team" }];
    case "billing":
      return [{ label: "Account" }, { label: "Billing" }];
    case "settings":
      return [{ label: "Account" }, { label: "Settings" }];
    default:
      return [{ label: "Not found" }];
  }
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const path = usePath();
  const currentApp = useCurrentApp(route);
  const [navOpen, setNavOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const crumbs = crumbsFor(route, currentApp);

  // A navigation closes the mobile menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `path` is the trigger
  useEffect(() => {
    setNavOpen(false);
  }, [path]);

  useEffect(() => {
    if (!navOpen) return;
    document.querySelector<HTMLButtonElement>(".side-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="shell" data-nav-open={navOpen || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar route={route} currentApp={currentApp} onClose={() => setNavOpen(false)} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a mouse shortcut; Escape and the close button also work */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <div className="sidebar-scrim" onClick={() => setNavOpen(false)} />
      <div className="shell-main">
        <header className="topbar">
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-ghost btn-icon menu-toggle"
            aria-label="Open menu"
            aria-controls="sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: crumbs are positional
                  <li key={index}>
                    {last ? (
                      <span aria-current="page">{crumb.label}</span>
                    ) : crumb.to ? (
                      <Link to={crumb.to}>{crumb.label}</Link>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="topbar-actions">
            <a className="btn btn-ghost btn-sm" href={DOCS_URL} target="_blank" rel="noreferrer">
              <Icon name="book" />
              Docs
            </a>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
