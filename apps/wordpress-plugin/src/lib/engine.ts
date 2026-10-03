import type { SemanticProvider } from "emojisense";
import {
  createApiSemantic,
  createEngineLoader as createPackLoader,
  type EngineLoader,
} from "emojisense/autocomplete";
import type { ClientConfig } from "./config.js";

export type { EngineLoader };

export interface EngineLoaderOptions {
  config: ClientConfig;
  fetch?: typeof fetch;
  /** Runs a task when the browser is idle. Tests pass a synchronous one. */
  whenIdle?: (task: () => void) => void;
}

/** The packs of this site, loaded once on first use (core packs, then the extension when idle). */
export function createEngineLoader(options: EngineLoaderOptions): EngineLoader {
  const { config } = options;
  return createPackLoader({
    packUrl: config.packUrl,
    locale: config.locale,
    // "" is the admin's "off": the loader's default would load the file next to the packs.
    cultureUrl: config.cultureUrl || false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.whenIdle ? { whenIdle: options.whenIdle } : {}),
  });
}

const providers = new WeakMap<ClientConfig, Map<string, SemanticProvider | undefined>>();

/**
 * The API's shards, then the API, as a semantic provider, only when search by meaning is on. The
 * API host serves the shards (/p/<packVersion>): free files, asked first. One provider per config
 * and pack version, so the shards it loaded stay loaded when the extension packs arrive.
 */
export function semanticProvider(
  config: ClientConfig,
  packVersion: string,
  fetchImpl?: typeof fetch,
): SemanticProvider | undefined {
  if (fetchImpl) return createProvider(config, packVersion, fetchImpl);
  let byVersion = providers.get(config);
  if (!byVersion) {
    byVersion = new Map();
    providers.set(config, byVersion);
  }
  if (!byVersion.has(packVersion)) byVersion.set(packVersion, createProvider(config, packVersion));
  return byVersion.get(packVersion);
}

function createProvider(config: ClientConfig, packVersion: string, fetchImpl?: typeof fetch) {
  return createApiSemantic({
    endpoint: config.endpoint,
    key: config.key,
    packVersion,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
