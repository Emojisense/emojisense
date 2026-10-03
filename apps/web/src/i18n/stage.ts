/**
 * The integration stage's part of the catalog (integrations.stage), shared by the stage island and
 * its skins. IntegrationStage provides it; a skin reads it with `useStageI18n()`.
 */
import type { Messages } from "./catalogs";
import { createI18nContext } from "./react";

export type StageMessages = Messages["integrations"]["stage"];

const context = createI18nContext<StageMessages>();

export const StageI18nProvider = context.Provider;
export const useStageI18n = context.useI18n;
