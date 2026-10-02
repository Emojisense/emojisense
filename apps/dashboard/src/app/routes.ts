import type { Feature } from "./lib/plans";
import type { IconName } from "./ui/Icon";

export const APP_SECTIONS = [
  "overview",
  "keys",
  "emoji",
  "analytics",
  "emoji-sets",
  "tenants",
  "webhooks",
] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

export type Route =
  | { name: "apps" }
  | { name: "app"; appId: string; section: AppSection }
  | { name: "team" }
  | { name: "billing" }
  | { name: "settings" }
  | { name: "invite"; token: string }
  | { name: "not-found" };

export interface SectionInfo {
  label: string;
  icon: IconName;
  /** The feature that needs a paid plan, for the lock hint in the sidebar. */
  feature?: Feature;
}

export const SECTION_INFO: Record<AppSection, SectionInfo> = {
  overview: { label: "Overview", icon: "overview" },
  keys: { label: "Keys", icon: "key" },
  emoji: { label: "Custom emoji", icon: "smile", feature: "custom_emoji" },
  analytics: { label: "Analytics", icon: "chart", feature: "analytics" },
  "emoji-sets": { label: "Emoji sets", icon: "layers", feature: "hosted_sets" },
  tenants: { label: "Tenants", icon: "building", feature: "tenants" },
  webhooks: { label: "Webhooks", icon: "bolt", feature: "webhooks" },
};

function decode(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(path: string): Route {
  const parts = path.split("/").filter(Boolean);
  const [first, second, third, ...rest] = parts;
  if (rest.length > 0) return { name: "not-found" };
  if (!first || (first === "apps" && !second)) return { name: "apps" };
  if (parts.length === 1 && (first === "team" || first === "billing" || first === "settings")) {
    return { name: first };
  }
  if (first === "invite" && !third) {
    const token = decode(second);
    return token ? { name: "invite", token } : { name: "not-found" };
  }
  if (first === "apps") {
    const appId = decode(second);
    const section = (third ?? "overview") as AppSection;
    if (appId && APP_SECTIONS.includes(section) && third !== "overview")
      return { name: "app", appId, section };
  }
  return { name: "not-found" };
}

export function appHref(appId: string, section: AppSection = "overview"): string {
  const base = `/apps/${encodeURIComponent(appId)}`;
  return section === "overview" ? base : `${base}/${section}`;
}
