/**
 * The demos' part of the catalog, shared by every component inside the use-case island. UseCases
 * provides it; a demo reads it with `useDemoI18n()`.
 */
import type { Messages } from "./catalogs";
import { createI18nContext } from "./react";

export type DemoMessages = Messages["demos"];

const context = createI18nContext<DemoMessages>();

export const DemoI18nProvider = context.Provider;
export const useDemoI18n = context.useI18n;
