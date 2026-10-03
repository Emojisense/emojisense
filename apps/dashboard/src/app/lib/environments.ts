import { ENVIRONMENTS, type Environment, type PlanId, planHasEnvironment } from "@emojisense/platform";
import type { KeySummary } from "../../shared/contract";

export { ENVIRONMENTS, type Environment, planHasEnvironment };

export interface EnvironmentInfo {
  label: string;
  emoji: string;
  /** One line on what the environment's keys are for. */
  text: string;
}

export const ENVIRONMENT_INFO: Record<Environment, EnvironmentInfo> = {
  prod: {
    label: "Production",
    emoji: "🚀",
    text: "Live traffic. Publishable keys answer only the origins you allow.",
  },
  staging: {
    label: "Staging",
    emoji: "🧪",
    text: "QA and release candidates, with their own keys and origins.",
  },
  dev: {
    label: "Development",
    emoji: "🛠️",
    text: "Localhost and preview builds. Publishable dev keys can allow any origin.",
  },
};

export function isEnvironment(value: string | null): value is Environment {
  return value !== null && (ENVIRONMENTS as readonly string[]).includes(value);
}

/** A dev or staging key whose app's plan no longer includes its environment: the API answers 402. */
export function isPaused(key: KeySummary, plan: PlanId): boolean {
  return !planHasEnvironment(plan, key.environment);
}

export function countActiveKeys(keys: KeySummary[]): Record<Environment, number> {
  const counts: Record<Environment, number> = { prod: 0, staging: 0, dev: 0 };
  for (const key of keys) if (key.revokedAt === null) counts[key.environment] += 1;
  return counts;
}
