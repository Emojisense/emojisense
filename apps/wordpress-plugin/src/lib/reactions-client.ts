import { createReactedStore, emojiFromHex, formatCount, type ReactedStore } from "./reactions.js";

export interface Reaction {
  emoji: string;
  count: number;
}

/** What a bar belongs to: a post (or forum topic or reply), or a BuddyPress activity item. */
export interface ReactionTarget {
  type: string;
  id: number;
}

export interface ReactionsApi {
  /** Counts and a fresh nonce (GET /emojisense/v1/reactions/:type/:id). */
  load(target: ReactionTarget): Promise<{ reactions: Reaction[]; nonce: string }>;
  /** POST /emojisense/v1/reactions/:type/:id. Rejects with a ReactionError. */
  react(target: ReactionTarget, emoji: string, action: "add" | "remove", nonce: string): Promise<Reaction[]>;
}

export class ReactionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The plugin's REST routes. `root` ends with "/reactions/". */
export function createReactionsApi(
  root: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  const url = ({ type, id }: ReactionTarget) => `${root}${encodeURIComponent(type)}/${id}`;
  const parse = async (response: Response) => {
    const body = (await response.json().catch(() => ({}))) as {
      reactions?: Reaction[];
      nonce?: string;
      code?: string;
    };
    if (!response.ok) throw new ReactionError(response.status, body.code ?? "error");
    return body;
  };
  const api: ReactionsApi = {
    async load(target) {
      const body = await parse(await fetchImpl(url(target), { credentials: "same-origin" }));
      return { reactions: body.reactions ?? [], nonce: body.nonce ?? "" };
    },
    async react(target, emoji, action, nonce) {
      const body = await parse(
        await fetchImpl(url(target), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Emojisense-Nonce": nonce },
          body: JSON.stringify({ emoji, action }),
        }),
      );
      return body.reactions ?? [];
    },
  };
  return api;
}

export interface ReactionBarOptions {
  api: ReactionsApi;
  store?: ReactedStore;
  strings?: { limited?: string; failed?: string };
  /** Number format locale; the page language by default. */
  locale?: string;
}

/**
 * Makes one server-rendered reaction bar work: fresh counts and a nonce when it scrolls into
 * view, then optimistic toggles that the server answer corrects.
 */
export function mountReactionBar(root: HTMLElement, options: ReactionBarOptions) {
  const target: ReactionTarget = {
    type: root.dataset.emojisenseType || "post",
    id: Number(root.dataset.emojisenseId),
  };
  const { api, strings = {} } = options;
  const store = options.store ?? createReactedStore(safeLocalStorage());
  const locale = options.locale ?? (root.ownerDocument.documentElement.lang || undefined);
  const status = root.querySelector<HTMLElement>(".emojisense-reactions__status");
  const buttons = new Map<string, HTMLButtonElement>();
  for (const button of root.querySelectorAll<HTMLButtonElement>(".emojisense-reaction")) {
    const emoji = emojiFromHex(button.dataset.emojiHex ?? "");
    if (emoji) buttons.set(emoji, button);
  }
  let nonce = "";
  let busy = false;

  const say = (text: string) => {
    if (status) status.textContent = text;
  };
  // Counts as numbers: the page shows them formatted, possibly in other digits (Arabic, Bengali).
  const counts = new Map<string, number>();
  const setCount = (emoji: string, count: number) => {
    counts.set(emoji, Math.max(0, count));
    const counter = buttons.get(emoji)?.querySelector(".emojisense-reaction__count");
    if (counter) counter.textContent = formatCount(count, locale);
  };
  const countOf = (emoji: string) => counts.get(emoji) ?? 0;
  const showCounts = (reactions: Reaction[]) => {
    for (const { emoji, count } of reactions) setCount(emoji, count);
  };
  const showPressed = () => {
    const mine = store.get(target.id, target.type);
    for (const [emoji, button] of buttons) button.setAttribute("aria-pressed", String(mine.has(emoji)));
  };

  const refresh = async () => {
    const { reactions, nonce: fresh } = await api.load(target);
    nonce = fresh;
    showCounts(reactions);
    showPressed();
    for (const button of buttons.values()) button.disabled = false;
  };

  const toggle = async (emoji: string) => {
    if (busy || !nonce) return;
    busy = true;
    say("");
    const on = !store.get(target.id, target.type).has(emoji);
    const before = countOf(emoji);
    setCount(emoji, before + (on ? 1 : -1));
    buttons.get(emoji)?.setAttribute("aria-pressed", String(on));
    const send = () => api.react(target, emoji, on ? "add" : "remove", nonce);
    try {
      let reactions: Reaction[];
      try {
        reactions = await send();
      } catch (error) {
        // The nonce may be older than the cached page allows: get a fresh one, once.
        if (!(error instanceof ReactionError) || error.status !== 403) throw error;
        nonce = (await api.load(target)).nonce;
        reactions = await send();
      }
      store.toggle(target.id, emoji, on, target.type);
      showCounts(reactions);
    } catch (error) {
      setCount(emoji, before);
      buttons.get(emoji)?.setAttribute("aria-pressed", String(!on));
      const limited = error instanceof ReactionError && error.status === 429;
      say(
        (limited ? strings.limited : strings.failed) ??
          (limited ? "Too many reactions. Wait a minute." : "Try again."),
      );
    } finally {
      busy = false;
    }
  };

  for (const [emoji, button] of buttons) button.addEventListener("click", () => void toggle(emoji));

  const start = () =>
    refresh().catch(() => {
      // Counts from the page stay; the buttons stay off.
    });
  const view = root.ownerDocument.defaultView;
  if (view && "IntersectionObserver" in view) {
    const observer = new view.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void start();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root);
  } else {
    void start();
  }
  return { refresh, toggle };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
