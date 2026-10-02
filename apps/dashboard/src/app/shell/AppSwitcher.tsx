import { useId } from "react";
import type { App } from "../api";
import { appEmoji } from "../lib/identity";
import { Link } from "../router";
import { type AppSection, appHref } from "../routes";
import { EnvBadge } from "../ui/Badges";
import { Icon } from "../ui/Icon";
import { usePopover } from "../ui/usePopover";
import { useApps } from "./context";

interface AppSwitcherProps {
  current: App | null;
  /** Switching keeps the current section, so Keys → Keys of the other app. */
  section: AppSection;
}

export function AppSwitcher({ current, section }: AppSwitcherProps) {
  const { apps } = useApps();
  const popover = usePopover();
  const menuId = useId();
  const list = apps.status === "ready" ? apps.data : current ? [current] : [];

  return (
    <div className="switcher" ref={popover.containerRef}>
      <button
        ref={popover.buttonRef}
        type="button"
        className="switcher-button"
        aria-expanded={popover.open}
        aria-controls={menuId}
        aria-label={current ? `Current app: ${current.name}. Switch app` : "Choose an app"}
        onClick={popover.toggle}
      >
        <span className="avatar emoji" aria-hidden="true">
          {current ? appEmoji(current.id) : "✨"}
        </span>
        <span className="switcher-text">
          <span className="switcher-name">{current?.name ?? "Choose an app"}</span>
          <span className="switcher-meta">
            {current ? <EnvBadge environment={current.environment} /> : `${list.length} apps`}
          </span>
        </span>
        <Icon name="chevrons" className="switcher-chevron" />
      </button>
      {popover.open && (
        <div id={menuId} className="menu">
          <p className="menu-label">Apps</p>
          <ul>
            {list.map((app) => (
              <li key={app.id}>
                <Link
                  to={appHref(app.id, section)}
                  className="menu-item"
                  aria-current={app.id === current?.id ? "page" : undefined}
                  onClick={() => popover.close()}
                >
                  <span className="avatar emoji" aria-hidden="true">
                    {appEmoji(app.id)}
                  </span>
                  <span className="switcher-item-text">
                    <span>{app.name}</span>
                    <EnvBadge environment={app.environment} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {apps.status === "error" && <p className="menu-label">Apps did not load.</p>}
          <div className="menu-sep" />
          <Link to="/apps" className="menu-item" onClick={() => popover.close()}>
            <Icon name="overview" />
            All apps
          </Link>
          <Link to="/apps?new=1" className="menu-item" onClick={() => popover.close()}>
            <Icon name="plus" />
            Create app
          </Link>
        </div>
      )}
    </div>
  );
}
