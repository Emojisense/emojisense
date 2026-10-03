/**
 * The culture logic without file access (`@emojisense/data/culture-core`): validation, the
 * exclusion policy, compiling, the eval gate, previews, drafts and live-entry merging. The API
 * Worker imports this; Node scripts import `@emojisense/data/culture`, which adds the file loaders.
 * Nothing reachable from here may import a `node:` module.
 */
export {
  activeBetween,
  addDays,
  CULTURE_DAYS,
  CULTURE_GZIP_BUDGET,
  compileCulture,
  featuredOn,
  KIND_ORDER,
  triggersFor,
  zonesFor,
} from "./compile.ts";
export {
  answerSchema,
  candidateEmoji,
  type DraftAnswer,
  type DraftCandidate,
  type EmojiOption,
  fillPrompt,
  formatEmojiOptions,
  MAX_DRAFT_TRIGGERS,
  MAX_EMOJI_OPTIONS,
  parseModelAnswer,
  splitPrompt,
  toDraftRecord,
} from "./draft.ts";
export {
  type CultureGateResult,
  type CultureGateRun,
  type GateQuery,
  gateFailed,
  type RegionalIssue,
  runCultureGateWith,
  type TopChange,
  TRIGGER_TOP_N,
  type TriggerMiss,
} from "./gate.ts";
export { type LiveMerge, mergeLiveEntries, TriggerIndex, withoutTakenTriggers } from "./live.ts";
export {
  type DatedCandidate,
  type DatedSource,
  datedCandidates,
  type Occurrence,
  occurrencesBetween,
  type SlangSource,
  type SourceFile,
  splitSources,
} from "./occurrences.ts";
export { type Exclusion, findExcluded, parseExclusions } from "./policy.ts";
export {
  type LocalePreview,
  type PreviewOptions,
  type PreviewResult,
  previewRecord,
  type RecordPreview,
  type RegionPreview,
  type TriggerPreview,
} from "./preview.ts";
export { probeRegions, type RegionProbes } from "./regional.ts";
export type { CultureRecord, Issue, IssueLevel, RecordSource, RecordStatus } from "./types.ts";
export {
  LIMITS,
  targetLocales,
  type ValidationContext,
  validateRecord,
  validateRecords,
} from "./validate.ts";
