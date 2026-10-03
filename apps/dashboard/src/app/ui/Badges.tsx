import { getPlan, type KeyKind, type PlanId } from "@emojisense/platform";
import type { App, Role } from "../api";
import { ENVIRONMENT_INFO, ENVIRONMENTS, type Environment, planHasEnvironment } from "../lib/environments";

const ENV_STYLE: Record<Environment, string> = {
  prod: "badge badge-mono badge-solid",
  staging: "badge badge-mono",
  dev: "badge badge-mono badge-dashed",
};

/** prod is filled, staging outlined, dev dashed: three states without color. */
export function EnvBadge({ environment }: { environment: Environment }) {
  return (
    <span className={ENV_STYLE[environment]} title={`${ENVIRONMENT_INFO[environment].label} key`}>
      {environment}
    </span>
  );
}

/**
 * The app's three environments in a row: a filled dot has active keys, a hollow one has none yet,
 * and a faded one is not on the app's plan.
 */
export function EnvironmentDots({ app }: { app: App }) {
  return (
    <ul className="env-dots" aria-label="Environments">
      {ENVIRONMENTS.map((environment) => {
        const count = app.activeKeysByEnvironment[environment];
        const state = !planHasEnvironment(app.plan, environment) ? "locked" : count > 0 ? "live" : "empty";
        const label = ENVIRONMENT_INFO[environment].label;
        const title =
          state === "locked"
            ? `${label}: not on this plan`
            : `${label}: ${count} active key${count === 1 ? "" : "s"}`;
        return (
          <li key={environment} data-state={state} title={title}>
            <span className="visually-hidden">{title}</span>
            <span aria-hidden="true">{environment}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanBadge({ plan }: { plan: PlanId }) {
  return <span className="badge badge-soft">{getPlan(plan).name}</span>;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role];
}

export function RoleBadge({ value: role }: { value: Role }) {
  return <span className={role === "owner" ? "badge badge-solid" : "badge"}>{ROLE_LABEL[role]}</span>;
}

export type Tone = "good" | "bad" | "idle";

/** Status with a dot and a word, never color alone. */
export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className="pill badge badge-dot" data-tone={tone}>
      {children}
    </span>
  );
}

const KIND: Record<KeyKind, { emoji: string; label: string }> = {
  publishable: { emoji: "🌐", label: "Publishable" },
  secret: { emoji: "🔒", label: "Secret" },
};

export function KindBadge({ kind }: { kind: KeyKind }) {
  return (
    <span className="badge">
      <span className="emoji" aria-hidden="true">
        {KIND[kind].emoji}
      </span>
      {KIND[kind].label}
    </span>
  );
}
