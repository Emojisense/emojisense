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

/** The counts, and the reactions the server's receipt cookie lists for this browser. */
export interface ReactionState {
  reactions: Reaction[];
  mine?: string[];
}

export interface ReactionsApi {
  /** Counts and a fresh nonce (GET /emojisense/v1/reactions/:type/:id). */
  load(target: ReactionTarget): Promise<{ reactions: Reaction[]; nonce: string }>;
  /** POST /emojisense/v1/reactions/:type/:id. Rejects with a ReactionError. */
  react(
    target: ReactionTarget,
    emoji: string,
    action: "add" | "remove",
    nonce: string,
  ): Promise<ReactionState>;
}

export class ReactionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** The server's message for the visitor. */
    readonly text?: string,
    /** When the server refused the change (409): the state to catch up with. */
    readonly state?: ReactionState,
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
      mine?: string[];
      nonce?: string;
      code?: string;
      message?: string;
      data?: { reactions?: Reaction[]; mine?: string[] };
    };
    if (!response.ok) {
      const state = body.data?.mine
        ? { reactions: body.data.reactions ?? [], mine: body.data.mine }
        : undefined;
      throw new ReactionError(response.status, body.code ?? "error", body.message, state);
    }
    return body;
  };
  const api: ReactionsApi = {
    async load(target) {
      const body = await parse(await fetchImpl(url(target), { credentials: "same-origin" }));
      return { reactions: body.reactions ?? [], nonce: body.nonce ?? "" };
    },
    async react(target, emoji, action, nonce) {
      // "same-origin" sends the receipt cookie that lets this browser take its reactions back.
      const body = await parse(
        await fetchImpl(url(target), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Emojisense-Nonce": nonce },
          body: JSON.stringify({ emoji, action }),
        }),
      );
      return { reactions: body.reactions ?? [], mine: body.mine };
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
  // The server's receipt wins over local memory: another tab, cleared cookies, older reactions.
  const remember = (mine: readonly string[]) => {
    const stored = store.get(target.id, target.type);
    for (const emoji of buttons.keys()) {
      const on = mine.includes(emoji);
      if (stored.has(emoji) !== on) store.toggle(target.id, emoji, on, target.type);
    }
    showPressed();
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
      let result: ReactionState;
      try {
        result = await send();
      } catch (error) {
        // The nonce may be older than the cached page allows: get a fresh one, once.
        if (!(error instanceof ReactionError) || error.status !== 403) throw error;
        nonce = (await api.load(target)).nonce;
        result = await send();
      }
      if (result.mine) remember(result.mine);
      else store.toggle(target.id, emoji, on, target.type);
      showCounts(result.reactions);
    } catch (error) {
      setCount(emoji, before);
      buttons.get(emoji)?.setAttribute("aria-pressed", String(!on));
      if (error instanceof ReactionError && error.state) {
        showCounts(error.state.reactions);
        remember(error.state.mine ?? []);
        say(error.text ?? "");
      } else if (error instanceof ReactionError && error.status === 429) {
        say(error.text ?? strings.limited ?? "Too many reactions. Wait a minute.");
      } else {
        say(strings.failed ?? "Try again.");
      }
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
