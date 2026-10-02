import { PLANS, type PlanId } from "@emojisense/platform";
import { useId, useState } from "react";
import type { App } from "../api";
import { useAdminStatus } from "../lib/admin";
import { DOCS_URL } from "../lib/config";
import { initials } from "../lib/identity";
import { FEATURE_PLAN, type Feature, planIncludes } from "../lib/plans";
import { Link } from "../router";
import { APP_SECTIONS, type AppSection, appHref, type Route, SECTION_INFO } from "../routes";
import { useSession } from "../session";
import { Icon, type IconName } from "../ui/Icon";
import { usePopover } from "../ui/usePopover";
import { AppSwitcher } from "./AppSwitcher";

interface SidebarProps {
  route: Route;
  currentApp: App | null;
  onClose: () => void;
}

const ACCOUNT_LINKS: { name: "team" | "billing" | "settings"; label: string; icon: IconName }[] = [
  { name: "team", label: "Team", icon: "users" },
  { name: "billing", label: "Billing", icon: "card" },
  { name: "settings", label: "Settings", icon: "sliders" },
];

export function Sidebar({ route, currentApp, onClose }: SidebarProps) {
  const { me } = useSession();
  const section: AppSection = route.name === "app" ? route.section : "overview";

  return (
    <aside className="sidebar" id="sidebar" aria-label="Sidebar">
      <div className="side-brand">
        <Link to="/apps" className="wordmark" aria-label="Emojisense, all apps">
          <span className="wordmark-glyph emoji" aria-hidden="true">
            🦖
          </span>
          <span className="wordmark-word">emojisense</span>
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm side-close"
          aria-label="Close menu"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="side-scroll">
        <AppSwitcher current={currentApp} section={section} />

        {currentApp && (
          <nav className="nav-group" aria-label={`${currentApp.name} app`}>
            {APP_SECTIONS.map((name) => {
              const info = SECTION_INFO[name];
              // App features follow the app's plan, which is its owner's.
              const locked = info.feature && !planIncludes(currentApp.plan, info.feature);
              const active = route.name === "app" && route.section === name;
              return (
                <Link
                  key={name}
                  to={appHref(currentApp.id, name)}
                  className="nav-link"
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={info.icon} />
                  {info.label}
                  {locked && info.feature && <LockHint feature={info.feature} />}
                </Link>
              );
            })}
          </nav>
        )}

        <InternalLinks route={route} />

        <nav className="nav-group" aria-label="Account">
          <p className="nav-label" aria-hidden="true">
            Account
          </p>
          {ACCOUNT_LINKS.map((link) => (
            <Link
              key={link.name}
              to={`/${link.name}`}
              className="nav-link"
              aria-current={route.name === link.name ? "page" : undefined}
            >
              <Icon name={link.icon} />
              {link.label}
              {link.name === "team" && !planIncludes(me.plan.id, "team") && <LockHint feature="team" />}
            </Link>
          ))}
        </nav>
      </div>

      <div className="side-foot">
        {(me.plan.id !== "scale" || me.billingStatus === "past_due") && <PlanNudge />}
        <AccountMenu />
      </div>
    </aside>
  );
}

/** Internal pages, only for ADMIN_EMAILS accounts (GET /api/admin). */
function InternalLinks({ route }: { route: Route }) {
  const status = useAdminStatus();
  if (!status?.admin) return null;
  return (
    <nav className="nav-group" aria-label="Internal">
      <p className="nav-label" aria-hidden="true">
        Internal
      </p>
      <Link
        to="/internal/culture"
        className="nav-link"
        aria-current={route.name === "culture" ? "page" : undefined}
      >
        <Icon name="sparkle" />
        Culture
      </Link>
    </nav>
  );
}

function LockHint({ feature }: { feature: Feature }) {
  const name = PLANS[FEATURE_PLAN[feature]].name;
  return (
    <span className="nav-lock" title={`Available on ${name}`}>
      {name}
    </span>
  );
}

/** What the next plan adds, in a line. Scale has no next plan and shows no nudge. */
const NEXT_PLAN_PITCH: Record<PlanId, string> = {
  free: "Custom emoji, analytics and a team come with paid plans.",
  solo: "Analytics, Slack import and a team come with Pro.",
  pro: "Tenants and webhooks come with Scale.",
  scale: "",
};

function PlanNudge() {
  const { me } = useSession();
  return (
    <div className="side-plan">
      <div className="side-plan-head">
        <span>{me.plan.name} plan</span>
        <Link to="/billing" className="btn btn-sm">
          {me.billingStatus === "past_due" ? "Billing" : "Upgrade"}
        </Link>
      </div>
      <p>
        {me.billingStatus === "past_due"
          ? "The last payment failed. Update the card in Billing."
          : NEXT_PLAN_PITCH[me.plan.id]}
      </p>
    </div>
  );
}

function AccountMenu() {
  const { me, signOut } = useSession();
  const popover = usePopover();
  const menuId = useId();
  const [busy, setBusy] = useState(false);
  const name = me.account.name ?? me.account.email ?? "Signed in";

  return (
    <div className="account" ref={popover.containerRef}>
      <button
        ref={popover.buttonRef}
        type="button"
        className="account-button"
        aria-expanded={popover.open}
        aria-controls={menuId}
        aria-label={`Account: ${name}`}
        onClick={popover.toggle}
      >
        <span className="avatar avatar-person" aria-hidden="true">
          {initials(me.account.name, me.account.email)}
        </span>
        <span className="account-text">
          <span className="account-name">{name}</span>
          {me.account.email && <span className="account-email">{me.account.email}</span>}
        </span>
        <Icon name="chevrons" className="switcher-chevron" />
      </button>
      {popover.open && (
        <div id={menuId} className="menu">
          <Link to="/settings" className="menu-item" onClick={() => popover.close()}>
            <Icon name="sliders" />
            Settings
          </Link>
          <a href={DOCS_URL} className="menu-item" target="_blank" rel="noreferrer">
            <Icon name="book" />
            Documentation
          </a>
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="signOut" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
