import { getPlan, type KeyKind, type PlanId } from "@emojisense/platform";
import type { Environment } from "../../shared/contract";
import type { Role } from "../api";

const ENV_STYLE: Record<Environment, string> = {
  prod: "badge badge-mono badge-solid",
  staging: "badge badge-mono",
  dev: "badge badge-mono badge-dashed",
};

/** prod is filled, staging outlined, dev dashed: three states without color. */
export function EnvBadge({ environment }: { environment: Environment }) {
  return (
    <span className={ENV_STYLE[environment]} title={`${environment} environment`}>
      {environment}
    </span>
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
