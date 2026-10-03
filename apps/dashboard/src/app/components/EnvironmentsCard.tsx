import { useId } from "react";
import type { App } from "../api";
import { ENVIRONMENT_INFO, ENVIRONMENTS, type Environment, planHasEnvironment } from "../lib/environments";
import { Link } from "../router";
import { appHref } from "../routes";
import { Icon } from "../ui/Icon";

const keysHref = (app: App, environment: Environment) =>
  `${appHref(app.id, "keys")}${environment === "prod" ? "" : `?env=${environment}`}`;

/** The app's environments side by side. A locked one links to its preview on the Keys page. */
export function EnvironmentsCard({ app }: { app: App }) {
  const headingId = useId();
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <div>
          <h2 id={headingId} className="card-title">
            Environments
          </h2>
          <p className="card-sub">
            Each environment has its own keys. Custom emoji and analytics are shared.
          </p>
        </div>
      </div>
      <ul className="env-grid">
        {ENVIRONMENTS.map((environment) => {
          const info = ENVIRONMENT_INFO[environment];
          const locked = !planHasEnvironment(app.plan, environment);
          const count = app.activeKeysByEnvironment[environment];
          return (
            <li key={environment} className="env-cell" data-locked={locked || undefined}>
              <div className="env-cell-head">
                <span className="env-cell-emoji emoji" aria-hidden="true">
                  {info.emoji}
                </span>
                <h3 className="env-cell-title">{info.label}</h3>
                {locked && count > 0 ? (
                  <span className="badge badge-dot" data-tone="idle">
                    {count} paused
                  </span>
                ) : locked ? (
                  <Icon name="lock" className="env-cell-lock" />
                ) : (
                  <span className="badge badge-dot" data-tone={count > 0 ? "good" : "idle"}>
                    {count > 0 ? `${count} active` : "No keys"}
                  </span>
                )}
              </div>
              <p className="env-cell-text">{info.text}</p>
              <Link to={keysHref(app, environment)} className="env-cell-link">
                {locked && count === 0 ? "See what you get" : count > 0 ? "Manage keys" : "Create a key"}
                <span className="visually-hidden"> for {info.label.toLowerCase()}</span>
                <Icon name="arrowRight" className="env-cell-arrow" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
