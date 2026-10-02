import type { KeyKind } from "@emojisense/platform";
import type { Environment } from "../../shared/contract";

export function PlanPill({ name }: { name: string }) {
  return (
    <span className="pill" data-tone="plan">
      {name}
    </span>
  );
}

export function EnvironmentPill({ environment }: { environment: Environment }) {
  return (
    <span className="pill" data-tone={environment}>
      {environment}
    </span>
  );
}

const KIND_PILL: Record<KeyKind, { emoji: string; label: string }> = {
  publishable: { emoji: "🌐", label: "Publishable" },
  secret: { emoji: "🔒", label: "Secret" },
};

export function KindPill({ kind }: { kind: KeyKind }) {
  const { emoji, label } = KIND_PILL[kind];
  return (
    <span className="pill">
      <span className="pill-emoji" aria-hidden="true">
        {emoji}
      </span>
      {label}
    </span>
  );
}
