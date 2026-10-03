import {
  type AliasEngine,
  applySkinTone,
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  type Pack,
  type SearchResult,
  type SearchSession,
  type SemanticProvider,
  type SessionState,
  type SkinTone,
} from "emojisense";
import { type ClientMessage, isClientMessage, type PickerItem, type ServerMessage } from "../shared/messages";
import { type SearchLanguages, type Settings, searchLanguages, semanticConfig } from "../shared/settings";
import { recentsToShow } from "./recents";

/** Eight columns × five rows. */
export const RESULT_LIMIT = 40;

/** The parts of chrome.runtime.Port this module uses (a fake in tests). */
export interface SearchPort {
  postMessage(message: ServerMessage): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface SearchServiceDeps {
  /** The bundled packs of these locales: core parts first (English first), then the ext parts. */
  loadPacks(locales: readonly string[]): Promise<Pack[]>;
  readSettings(): Promise<Settings>;
  readRecents(): Promise<string[]>;
  recordPick(id: string): Promise<void>;
  uiLanguage(): string;
  /** The browser's preferred languages, most preferred first (`navigator.languages`). */
  browserLanguages(): readonly string[];
  fetch?: typeof fetch;
  debounceMs?: number;
}

export interface SearchService {
  /** Load the packs of the user's languages and build the index (again only when they change). */
  warm(): Promise<AliasEngine>;
  /** Serve one open picker over its port. */
  attach(port: SearchPort): void;
}

interface PortContext {
  engine: AliasEngine;
  locale: string;
  tone: SkinTone;
}

/**
 * Search runs in the service worker, not in each page: one index (≈ 25 MB for English and Turkish,
 * ≈ 150 ms to build) serves every tab, and the bundled packs are read from the extension, not
 * exposed to sites. Every pack language ships, but the index holds only the user's languages.
 * The index is a cache: when Chrome stops the idle worker it is rebuilt on the next open.
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  let engine: { key: string; building: Promise<AliasEngine> } | undefined;
  // Reused across pickers so the client's response cache and over-limit pause carry over.
  const clients = new Map<string, SemanticProvider>();

  function languagesFor(settings: Settings): SearchLanguages {
    // The UI language comes last: it is one of the user's languages, but rarely the one to prefer.
    return searchLanguages(settings.locale, [...deps.browserLanguages(), deps.uiLanguage()]);
  }

  /** The index of these locales. A new set (a settings change) replaces the old index. */
  function engineFor(locales: readonly string[]): Promise<AliasEngine> {
    const key = [...locales].sort().join(",");
    if (engine?.key !== key) {
      const current = { key, building: deps.loadPacks(locales).then((packs) => createEngine(packs)) };
      engine = current;
      current.building.catch(() => {
        if (engine === current) engine = undefined;
      });
    }
    return engine.building;
  }

  async function warm(): Promise<AliasEngine> {
    return engineFor(languagesFor(await deps.readSettings()).locales);
  }

  function semanticFor(settings: Settings, packVersion: string): SemanticProvider | undefined {
    const config = semanticConfig(settings);
    if (!config) return undefined;
    const cacheKey = `${config.endpoint}\n${config.key}\n${packVersion}`;
    let client = clients.get(cacheKey);
    if (!client) {
      // The API host serves the shards too (/p/<packVersion>): free files, asked before the API.
      client = createLayeredSemantic({
        shardsUrl: `${config.endpoint.replace(/\/+$/, "")}/p/${packVersion}`,
        endpoint: config.endpoint,
        packVersion,
        ...(config.key ? { key: config.key } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      if (client) clients.set(cacheKey, client);
    }
    return client;
  }

  function attach(port: SearchPort): void {
    let session: SearchSession | undefined;
    let context: PortContext | undefined;
    let pending: string | undefined;
    let connected = true;

    const post = (message: ServerMessage) => {
      if (!connected) return;
      try {
        port.postMessage(message);
      } catch {
        connected = false;
      }
    };

    const onState = (state: SessionState) => {
      if (!context) return;
      if (state.status === "idle") {
        void postRecents(state.query);
        return;
      }
      post({
        type: "results",
        query: state.query,
        status: state.status,
        items: toItems(state.results, context),
      });
    };

    const postRecents = async (query: string) => {
      if (!context) return;
      const ids = recentsToShow(await deps.readRecents().catch(() => []));
      const items = toItems(
        ids.map((id) => ({ emoji: "", id, score: 1, source: "alias" as const })),
        context,
      );
      post({ type: "results", query, status: "recent", items });
    };

    const handle = (message: ClientMessage) => {
      if (message.type === "picked") {
        void deps.recordPick(message.id).catch(() => undefined);
        return;
      }
      if (session) session.update(message.query);
      else pending = message.query;
    };

    port.onMessage.addListener((message) => {
      if (isClientMessage(message)) handle(message);
    });
    port.onDisconnect.addListener(() => {
      connected = false;
      session?.dispose();
    });

    const ready = deps.readSettings().then(async (settings) => {
      const { locale, locales } = languagesFor(settings);
      return { settings, locale, engine: await engineFor(locales) };
    });
    ready.then(
      ({ settings, locale, engine: loaded }) => {
        if (!connected) return;
        const semantic = semanticFor(settings, loaded.packVersion);
        context = { engine: loaded, locale, tone: settings.skinTone };
        // The index holds only the user's languages, so every loaded phrase may match.
        session = createSearchSession({
          engine: loaded,
          locale,
          limit: RESULT_LIMIT,
          onChange: onState,
          ...(semantic ? { semantic } : {}),
          ...(deps.debounceMs !== undefined ? { debounceMs: deps.debounceMs } : {}),
        });
        if (pending !== undefined) session.update(pending);
      },
      (error: unknown) => {
        post({ type: "unavailable", reason: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  return { warm, attach };
}

/**
 * Display-ready items. The pack row is the source of truth for the glyph (results from the API
 * may differ in variation selectors); ids the local pack does not know are dropped.
 */
export function toItems(results: readonly SearchResult[], context: PortContext): PickerItem[] {
  const items: PickerItem[] = [];
  for (const result of results) {
    const entry = context.engine.get(result.id);
    if (!entry) continue;
    items.push({
      emoji: entry.hasSkinTones ? applySkinTone(entry.emoji, context.tone) : entry.emoji,
      id: entry.id,
      label: entry.labels[context.locale] || entry.labels.en || "",
      source: result.source,
    });
  }
  return items;
}
