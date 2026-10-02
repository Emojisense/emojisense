import {
  type AliasEngine,
  applySkinTone,
  createEngine,
  createSearchSession,
  createSemanticClient,
  type Pack,
  type SearchResult,
  type SearchSession,
  type SemanticProvider,
  type SessionState,
  type SkinTone,
} from "emojisense";
import { type ClientMessage, isClientMessage, type PickerItem, type ServerMessage } from "../shared/messages";
import { resolveLocale, type Settings, semanticConfig } from "../shared/settings";
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
  loadPacks(): Promise<Pack[]>;
  readSettings(): Promise<Settings>;
  readRecents(): Promise<string[]>;
  recordPick(id: string): Promise<void>;
  uiLanguage(): string;
  fetch?: typeof fetch;
  debounceMs?: number;
}

export interface SearchService {
  /** Load the packs and build the index (once per worker lifetime). */
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
 * Search runs in the service worker, not in each page: one index (≈ 25 MB, ≈ 150 ms to build)
 * serves every tab, and the bundled packs are read from the extension, not exposed to sites.
 * The index is a cache: when Chrome stops the idle worker it is rebuilt on the next open.
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  let engine: Promise<AliasEngine> | undefined;
  // Reused across pickers so the client's response cache and over-limit pause carry over.
  const clients = new Map<string, SemanticProvider>();

  function warm(): Promise<AliasEngine> {
    if (!engine) {
      const building = deps.loadPacks().then((packs) => createEngine(packs));
      engine = building;
      building.catch(() => {
        if (engine === building) engine = undefined;
      });
    }
    return engine;
  }

  function semanticFor(settings: Settings, packVersion: string): SemanticProvider | undefined {
    const config = semanticConfig(settings);
    if (!config) return undefined;
    const cacheKey = `${config.endpoint}\n${config.key}\n${packVersion}`;
    let client = clients.get(cacheKey);
    if (!client) {
      client = createSemanticClient({
        endpoint: config.endpoint,
        packVersion,
        ...(config.key ? { key: config.key } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      clients.set(cacheKey, client);
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

    Promise.all([warm(), deps.readSettings()]).then(
      ([ready, settings]) => {
        if (!connected) return;
        const locale = resolveLocale(settings.locale, deps.uiLanguage());
        const semantic = semanticFor(settings, ready.packVersion);
        context = { engine: ready, locale, tone: settings.skinTone };
        session = createSearchSession({
          engine: ready,
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
