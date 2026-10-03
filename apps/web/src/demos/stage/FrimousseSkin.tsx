import { useEmojisense } from "@emojisense/react";
import { EmojisensePicker } from "@emojisense/react/frimousse";
import { useEffect, useId, useRef, useState } from "react";
import { API_URL, PACK_BASE_URL, PUBLISHABLE_KEY, SHARDS_URL } from "../../config";
import { useStageI18n } from "../../i18n/stage";
import { pageLocale } from "../../lib/engine-client";
import { waitFor } from "../chat/autoplay";
import { typeText, useSkinAutoplay, wait } from "./autoplay";
import type { SkinProps } from "./skins";

const bare = (emoji: string) => emoji.replaceAll("\uFE0F", "");

/** Searches the autoplay shows before its pick: a film, then a feeling. English is always searched. */
const TEASERS = ["jurassic park", "heartbroken"];

/** Types into the picker's own search field the way a keyboard does, so its React state follows. */
function setFieldValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The React integration as an app uses it: `useEmojisense` and the Frimousse picker, open next to
 * a chat composer. Browsing is Frimousse's; a typed query gets Emojisense's ranked results.
 */
function LiveChat({ skin, visible }: SkinProps) {
  const id = useId();
  const { messages } = useStageI18n();
  const words = messages.skins.react;
  const sense = useEmojisense({
    packBaseUrl: PACK_BASE_URL,
    shardsUrl: SHARDS_URL,
    endpoint: API_URL,
    publishableKey: PUBLISHABLE_KEY,
    locale: pageLocale(),
  });
  const [message, setMessage] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchField = () => rootRef.current?.querySelector<HTMLInputElement>("[frimousse-search]") ?? null;
  const resultOf = (emoji: string) =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-emojisense-results] [role='option']") ?? [],
    ).find((option) => bare(option.textContent ?? "") === bare(emoji));

  const line = `${words.line} `;
  useSkinAutoplay({
    root: rootRef,
    visible,
    ready: sense.status === "ready",
    async script(run) {
      if (!(await typeText(run, "", line, setMessage))) return;
      await wait(400);
      const field = searchField();
      if (!field) return;
      const write = (value: string) => setFieldValue(field, value);
      for (const query of TEASERS) {
        if (!(await typeText(run, "", query, write))) return;
        await wait(1300);
        if (run.cancelled) return;
        write("");
        await wait(250);
      }
      if (!(await typeText(run, "", skin.query, write))) return;
      const option = await waitFor(() => resultOf(skin.emoji), Boolean, 2500);
      // Time to read the ranked results before the pick.
      await wait(1200);
      if (run.cancelled || !option) return;
      option.classList.add("is-pressing");
      await wait(170);
      option.classList.remove("is-pressing");
      if (!run.cancelled) option.click();
    },
    finish: () => setMessage(`${line}${skin.emoji} `),
    reset: () => {
      setMessage("");
      const field = searchField();
      if (field) setFieldValue(field, "");
    },
  });

  return (
    <div className="stg-app stg-app-react" ref={rootRef}>
      <div className="stg-chat">
        <p className="stg-chat-head">
          <span aria-hidden="true">#</span>
          {words.channel}
        </p>
        <div className="stg-chat-body">
          <div className="stg-frimousse">
            <EmojisensePicker
              emojisense={sense}
              columns={8}
              placeholder={words.search}
              empty={<p className="stg-status">{words.empty}</p>}
              onEmojiSelect={({ emoji }) => setMessage((text) => `${text}${emoji} `)}
            />
          </div>
        </div>
        <div className="stg-chat-composer">
          <label className="visually-hidden" htmlFor={`${id}-message`}>
            {words.label}
          </label>
          <input
            id={`${id}-message`}
            type="text"
            value={message}
            placeholder={words.placeholder}
            autoComplete="off"
            onChange={(event) => setMessage(event.target.value)}
          />
          <span className="stg-chat-emoji emoji" aria-hidden="true">
            😊
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The live picker renders in the browser only: its first render depends on what the browser holds,
 * so the server (and hydration) get the same empty frame.
 */
export default function FrimousseSkin(props: SkinProps) {
  const { messages } = useStageI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (mounted) return <LiveChat {...props} />;
  return (
    <div className="stg-app stg-app-react">
      <div className="stg-chat">
        <p className="stg-chat-head">
          <span aria-hidden="true">#</span>
          {messages.skins.react.channel}
        </p>
        <div className="stg-chat-body">
          <div className="stg-frimousse">
            <div className="stg-frimousse-placeholder" />
          </div>
        </div>
        <div className="stg-chat-composer" />
      </div>
    </div>
  );
}
