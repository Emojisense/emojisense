export { createSemanticClient, type SemanticClient, type SemanticClientOptions } from "./client.js";
export {
  type AliasEngine,
  type AliasResult,
  type AliasSearchOptions,
  type AliasSearchOutput,
  createEngine,
  type EmojiEntry,
  type EngineOptions,
  type ResultSource,
  type SearchResult,
} from "./engine.js";
export { type FuseOptions, fuse, fuseResults, shouldUseSemantic } from "./fusion.js";
export { boundedEditDistance } from "./fuzzy.js";
export { groupLabel } from "./groups.js";
export { baseId, hexcodeOf } from "./ids.js";
export { createLayeredSemantic, type LayeredSemanticOptions } from "./layered.js";
export { type LoadPacksOptions, loadPacks } from "./loader.js";
export { MAX_QUERY_LENGTH, normalize, tokenize } from "./normalize.js";
export {
  assertPack,
  DEFAULT_WEIGHTS,
  FIELDS,
  type Field,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  type Pack,
  type PackRow,
  ROW as ROW_INDEX,
} from "./pack.js";
export {
  chainProviders,
  type SemanticLayer,
  type SemanticProvider,
  type SemanticResponse,
  type SemanticSearchOptions,
} from "./provider.js";
export {
  createSearchSession,
  type SearchSession,
  type SearchSessionOptions,
  type SessionState,
  type SessionStatus,
} from "./session.js";
export {
  EMOJI_SETS,
  type EmojiImageOptions,
  type EmojiSet,
  emojiImageUrl,
  type HostedEmojiSet,
  isEmojiSet,
} from "./sets.js";
export {
  createShardProvider,
  type Shard,
  type ShardIndex,
  type ShardProviderOptions,
  shardKeyFor,
} from "./shards.js";
export { applySkinTone, SKIN_TONES, type SkinTone } from "./skin.js";
export {
  decodeVectors,
  encodeVectors,
  l2normalize,
  searchVectors,
  type VectorIndex,
  type VectorMatch,
} from "./vectors.js";
