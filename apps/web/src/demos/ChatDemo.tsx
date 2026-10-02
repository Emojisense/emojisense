import type { AliasEngine } from "emojisense";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { englishEngine, fullEngine, useEngine } from "../lib/engine-client";
import { keystrokeDelay, type Run, wait, waitFor } from "./chat/autoplay";
import { Composer } from "./chat/Composer";
import { AUTOPLAY_MESSAGE, AUTOPLAY_STEPS, type Message, type Reaction, SEED_MESSAGES } from "./chat/content";
import { MembersIcon } from "./chat/icons";
import { MessageItem } from "./chat/MessageItem";
import { type ReactionSuggestions, suggestReactions } from "./chat/reactions";
import { Sidebar } from "./chat/Sidebar";
import { SuggestedReactions } from "./chat/SuggestedReactions";
import { type EmojiAutocomplete, useEmojiAutocomplete } from "./chat/useEmojiAutocomplete";
// The first tab is rendered on the server, so its styles ship with the page (no shift on reveal).
import "./chat.css";

const CHANNEL = "launch";
const MEMBER_COUNT = 12;
const START_DELAY_MS = 800;
const FULL_ENGINE_WAIT_MS = 2500;
const VS16 = String.fromCodePoint(0xfe0f);
const sameEmoji = (a: string, b: string) => a.replaceAll(VS16, "") === b.replaceAll(VS16, "");

/**
 * For the on-device fallback. Chat phrases like "thanks team" live in the English extension pack,
 * so it waits a moment for the full engine, then settles for English core.
 */
function reactionEngine(): Promise<AliasEngine | undefined> {
  const english = englishEngine().catch(() => undefined);
  return Promise.race([fullEngine(), wait(FULL_ENGINE_WAIT_MS).then(() => english)]).catch(() => english);
}

/** One answer per message text for the page's lifetime: the API is metered and text repeats. */
const suggestionCache = new Map<string, ReactionSuggestions>();

type AutoState = "waiting" | "playing" | "done" | "off";
type Pressing = "option" | "send" | undefined;

interface Driver {
  ac: EmojiAutocomplete;
  engine: AliasEngine | undefined;
  send: (text: string) => void;
  press: (key: Pressing) => void;
}

/** Your reaction on, or off again, like any chat app. */
function toggleReaction(reactions: Reaction[], emoji: string): Reaction[] {
  const current = reactions.find((r) => sameEmoji(r.emoji, emoji));
  if (!current) return [...reactions, { emoji, count: 1, mine: true, bump: 1 }];
  const count = current.count + (current.mine ? -1 : 1);
  if (count === 0) return reactions.filter((r) => r !== current);
  const next = { ...current, count, mine: !current.mine, bump: current.bump + 1 };
  return reactions.map((r) => (r === current ? next : r));
}

/** Types the scripted message like a person, picks 🐐 from the ":" popup and sends it. */
async function runAutoplay(run: Run, driver: () => Driver): Promise<void> {
  await wait(START_DELAY_MS);
  let text = "";
  const write = (next: string) => {
    text = next;
    driver().ac.edit(next, next.length);
  };
  const press = async (key: Exclude<Pressing, undefined>) => {
    driver().press(key);
    await wait(170);
    driver().press(undefined);
  };

  for (const step of AUTOPLAY_STEPS) {
    if (run.cancelled) return;
    if (step.kind === "pause") {
      await wait(step.ms);
    } else if (step.kind === "insert") {
      write(text + step.text);
    } else if (step.kind === "type") {
      for (const char of step.text) {
        await wait(keystrokeDelay(text.at(-1) ?? "", char));
        if (run.cancelled) return;
        write(text + char);
      }
    } else if (step.kind === "pick") {
      const findTarget = () => driver().ac.results.findIndex((r) => r.id === step.id);
      const target = await waitFor(findTarget, (index) => index >= 0, 2500);
      await wait(650);
      for (let row = 1; row <= target; row++) {
        if (run.cancelled) return;
        driver().ac.setActive(row);
        await wait(220);
      }
      if (run.cancelled) return;
      await press("option");
      const emoji = driver().ac.results[target]?.emoji ?? driver().engine?.get(step.id)?.emoji;
      if (emoji && !run.cancelled) driver().ac.pick(emoji);
      await wait(60);
      text = driver().ac.value;
    } else {
      await press("send");
      if (run.cancelled) return;
      driver().send(driver().ac.value);
    }
  }
}

/**
 * A team chat whose composer completes ":" codes and plain language with the real engine, and
 * suggests reactions for the newest message from the edge API (on-device fallback).
 */
export default function ChatDemo() {
  const { engine, ready } = useEngine();
  const ac = useEmojiAutocomplete(engine);
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [suggestions, setSuggestions] = useState<{
    messageId: string;
    data: ReactionSuggestions | undefined;
  }>();
  const [auto, setAuto] = useState<AutoState>("waiting");
  const [pressing, setPressing] = useState<Pressing>();
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const nextId = useRef(0);
  const runRef = useRef<Run | null>(null);

  const names = useMemo(
    () => new Map((engine?.entries ?? []).map((e) => [e.emoji.replaceAll(VS16, ""), e.labels.en ?? e.emoji])),
    [engine],
  );
  const nameOf = (emoji: string) => names.get(emoji.replaceAll(VS16, "")) ?? emoji;

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    stickToBottom.current = true;
    const id = `you-${++nextId.current}`;
    setMessages((list) => {
      const last = list.at(-1);
      const minute = !last ? 600 : last.author === "you" ? last.minute : last.minute + 3;
      return [...list, { id, author: "you", minute, text, reactions: [], fresh: true }];
    });
    ac.clear();
  };

  const react = (messageId: string, emoji: string) => {
    setMessages((list) =>
      list.map((m) => (m.id === messageId ? { ...m, reactions: toggleReaction(m.reactions, emoji) } : m)),
    );
  };

  const latest = useRef<Driver & { auto: AutoState }>({ ac, engine, send, press: setPressing, auto });
  useLayoutEffect(() => {
    latest.current = { ac, engine, send, press: setPressing, auto };
  });

  // Reduced motion: no typing, show the end state at once.
  useEffect(() => {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setAuto("off");
    setMessages((list) => [
      ...list,
      {
        id: "you-final",
        author: "you",
        minute: (list.at(-1)?.minute ?? 600) + 3,
        text: AUTOPLAY_MESSAGE,
        reactions: [],
      },
    ]);
  }, []);

  // Autoplay waits until the window is on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        // A third of the window, or half the screen when the window is taller than the screen.
        const screen = entry.rootBounds?.height ?? window.innerHeight;
        if (entry.intersectionRatio < 0.35 && entry.intersectionRect.height < screen / 2) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: [0, 0.1, 0.2, 0.35] },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The visitor's first touch, click, key or focus stops the autoplay for good.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = () => {
      const state = latest.current.auto;
      if (state === "off" || state === "done") return;
      if (runRef.current) runRef.current.cancelled = true;
      if (state === "playing") latest.current.ac.clear();
      setPressing(undefined);
      setAuto("off");
    };
    const events = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of events) root.addEventListener(type, stop, { capture: true });
    return () => {
      for (const type of events) root.removeEventListener(type, stop, { capture: true });
    };
  }, []);

  const canStart = auto === "waiting" && visible && engine !== undefined;
  useEffect(() => {
    if (!canStart || runRef.current) return;
    const run: Run = { cancelled: false };
    runRef.current = run;
    setAuto("playing");
    runAutoplay(run, () => latest.current).then(() => {
      if (!run.cancelled) setAuto("done");
    });
  }, [canStart]);
  useEffect(
    () => () => {
      if (runRef.current) runRef.current.cancelled = true;
    },
    [],
  );

  // Suggested reactions follow the newest message.
  const newest = messages.at(-1);
  const newestId = newest?.id;
  const newestText = newest?.text;
  useEffect(() => {
    if (!newestId || !newestText) return;
    const cached = suggestionCache.get(newestText);
    setSuggestions({ messageId: newestId, data: cached });
    if (cached) return;
    const controller = new AbortController();
    (async () => {
      const data = await suggestReactions(newestText, reactionEngine, controller.signal);
      if (controller.signal.aborted) return;
      suggestionCache.set(newestText, data);
      setSuggestions({ messageId: newestId, data });
    })();
    return () => controller.abort();
  }, [newestId, newestText]);

  // Stay pinned to the newest message unless the visitor scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the content height can change.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [messages, suggestions]);

  const onLogScroll = () => {
    const log = logRef.current;
    if (log) stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  };

  return (
    <div className="chat" ref={rootRef}>
      <section
        className="chat-window"
        aria-label="Demo: a team chat with Emojisense emoji autocomplete and suggested reactions"
      >
        <Sidebar />
        <div className="chat-main">
          <header className="chat-head">
            <p className="chat-title">
              <span className="chat-title-hash" aria-hidden="true">
                #
              </span>
              {CHANNEL}
            </p>
            <p className="chat-topic">Onboarding v2 rollout, launch day</p>
            <p className="chat-members">
              <MembersIcon />
              <span className="visually-hidden">Members: </span>
              {MEMBER_COUNT}
            </p>
          </header>

          <div
            className="chat-log"
            ref={logRef}
            role="log"
            aria-label={`Messages in #${CHANNEL}`}
            onScroll={onLogScroll}
          >
            <p className="chat-day">Today</p>
            {messages.map((message, i) => {
              const previous = messages[i - 1];
              const grouped =
                previous !== undefined &&
                previous.author === message.author &&
                message.minute - previous.minute <= 5;
              const mine = (emoji: string) =>
                message.reactions.some((r) => r.mine && sameEmoji(r.emoji, emoji));
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  grouped={grouped}
                  nameOf={nameOf}
                  onToggleReaction={(emoji) => react(message.id, emoji)}
                >
                  {suggestions?.messageId === message.id && (
                    <SuggestedReactions
                      data={suggestions.data}
                      isMine={mine}
                      nameOf={nameOf}
                      onPick={(emoji) => react(message.id, emoji)}
                    />
                  )}
                </MessageItem>
              );
            })}
          </div>

          <Composer
            ac={ac}
            engine={engine}
            ready={ready}
            channel={CHANNEL}
            onSend={() => send(ac.value)}
            ghostCaret={auto === "playing"}
            pressing={pressing}
          />
        </div>
      </section>
    </div>
  );
}
