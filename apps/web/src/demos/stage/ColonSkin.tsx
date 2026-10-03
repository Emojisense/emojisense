import type { AliasEngine, SearchResult } from "emojisense";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useStageI18n } from "../../i18n/stage";
import { expandClosedCode, shortcodeFor } from "../chat/shortcodes";
import { type EmojiAutocomplete, useEmojiAutocomplete } from "../chat/useEmojiAutocomplete";
import { highlightAndPick, typeText, useSkinAutoplay } from "./autoplay";
import { optionId, ResultsOrStatus, Timing } from "./ResultList";
import type { ColonSkinId, SkinProps } from "./skins";

/** `:sh` + `ship` → the typed part of the code in full ink, the rest muted. */
function Code({ code, query }: { code: string; query: string }) {
  const typed = query.toLowerCase().trim().replace(/\s+/g, "_");
  const match = typed && code.startsWith(typed) ? typed.length : 0;
  return (
    <span className="stg-code">
      :<b>{code.slice(0, match)}</b>
      {code.slice(match)}:
    </span>
  );
}

interface FieldProps {
  ac: EmojiAutocomplete;
  engine: AliasEngine | undefined;
  label: string;
  placeholder: string;
  /** Autoplay types: draw a caret, since the field is not focused. */
  ghostCaret: boolean;
  pressing: boolean;
  /** The list opens above the text (fields at the bottom of the window). */
  above: boolean;
}

/** A text field whose ":" opens ranked emoji at the colon, as the editor plugins do. */
function ColonField({ ac, engine, label, placeholder, ghostCaret, pressing, above }: FieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, line: 0 });
  const { trigger, results, session, active } = ac;
  const open = trigger !== undefined && (results.length > 0 || !engine || session?.status === "loading");

  useLayoutEffect(() => {
    const caret = ac.pendingCaret.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea) return;
    ac.pendingCaret.current = null;
    if (document.activeElement === textarea) textarea.setSelectionRange(caret, caret);
  });

  // The list starts at the colon, kept inside the field.
  const triggerStart = trigger?.start;
  useLayoutEffect(() => {
    const mark = anchorRef.current;
    if (triggerStart === undefined || !mark) return;
    setAnchor({ x: mark.offsetLeft, y: mark.offsetTop, line: mark.offsetHeight });
  }, [triggerStart]);

  const pick = (result: SearchResult | undefined) => {
    if (result) ac.pick(result.emoji);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target;
    const typedColon = (event.nativeEvent as InputEvent).data === ":";
    const expanded = typedColon ? expandClosedCode(engine, value, selectionStart) : undefined;
    if (expanded) {
      ac.edit(expanded.value, expanded.caret);
      ac.pendingCaret.current = expanded.caret;
    } else {
      ac.edit(value, selectionStart);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || !open) return;
    const count = results.length;
    if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      ac.setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (count > 0 && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      ac.dismiss();
    }
  };

  const value = ac.value;
  const before = triggerStart === undefined ? value : value.slice(0, triggerStart);
  const after = triggerStart === undefined ? "" : value.slice(triggerStart);
  const width = fieldRef.current?.clientWidth ?? 0;

  return (
    <div className="stg-field" ref={fieldRef}>
      <label className="visually-hidden" htmlFor={`${id}-input`}>
        {label}
      </label>
      <textarea
        id={`${id}-input`}
        ref={textareaRef}
        className="stg-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && results.length > 0 ? optionId(listId, active) : undefined}
        onChange={onChange}
        onSelect={(event) => ac.edit(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => ac.dismiss()}
      />
      <div className="stg-mirror" aria-hidden="true">
        {before}
        <span ref={anchorRef} />
        {after}
        {ghostCaret && <span key={value.length} className="stg-caret" />}
        {"​"}
      </div>
      {open && (
        <div
          className="stg-pop"
          data-above={above || undefined}
          style={{
            left: `clamp(0rem, ${anchor.x}px - 0.75rem, max(0rem, ${width}px - 19rem))`,
            top: above ? undefined : `${anchor.y + anchor.line + 6}px`,
            bottom: above ? `calc(100% - ${anchor.y}px + 6px)` : undefined,
          }}
        >
          <div className="stg-pop-head">
            <span className="stg-pop-query">:{trigger.query}</span>
            <Timing session={session} />
          </div>
          <ResultsOrStatus
            id={listId}
            engine={engine}
            ready={engine !== undefined}
            results={results}
            session={session}
            active={active}
            setActive={ac.setActive}
            onPick={pick}
            pressing={pressing}
            primary={(result) => <Code code={shortcodeFor(engine, result)} query={trigger.query} />}
          />
        </div>
      )}
    </div>
  );
}

const BOLD = "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z";
const ITALIC = "M10 5h7M7 19h7M14 5l-4 14";
const LINK =
  "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1";
const LIST = "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01";
const QUOTE = "M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z";
const IMAGE = "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01";
const UNDO = "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3";
const SMILE = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01";

/** Editor toolbar buttons, drawn only: the window is an illustration. */
function Tools({ paths }: { paths: string[] }) {
  return (
    <span className="stg-tools" aria-hidden="true">
      {paths.map((d) => (
        <svg key={d} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={d} />
        </svg>
      ))}
    </span>
  );
}

function Avatar({ name, hue }: { name: string; hue: number }) {
  return (
    <span className="stg-avatar" style={{ background: `oklch(0.72 0.12 ${hue})` }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** The window around the field: a doc page, an editor with its toolbar, a forum, a blog. */
function Chrome({ id, children }: { id: ColonSkinId; children: ReactNode }) {
  const { skins } = useStageI18n().messages;
  switch (id) {
    case "tiptap":
      return (
        <div className="stg-page">
          <p className="stg-crumbs" aria-hidden="true">
            <span>{skins.tiptap.space}</span> / <span>{skins.tiptap.title}</span>
          </p>
          <p className="stg-page-icon emoji" aria-hidden="true">
            📣
          </p>
          <h4 className="stg-page-title">{skins.tiptap.title}</h4>
          {children}
        </div>
      );
    case "ckeditor5":
      return (
        <div className="stg-editor">
          <div className="stg-toolbar">
            <span className="stg-select" aria-hidden="true">
              {skins.ckeditor5.style}
            </span>
            <Tools paths={[BOLD, ITALIC, LINK, LIST, QUOTE, IMAGE, UNDO]} />
          </div>
          <div className="stg-editor-body">
            <h4 className="stg-editor-title">{skins.ckeditor5.title}</h4>
            {children}
          </div>
        </div>
      );
    case "tinymce":
      return (
        <div className="stg-editor stg-editor-classic">
          <div className="stg-toolbar">
            <Tools paths={[UNDO, BOLD, ITALIC, LINK, LIST, IMAGE, SMILE]} />
          </div>
          <div className="stg-editor-body">
            <h4 className="stg-editor-title">{skins.tinymce.title}</h4>
            {children}
          </div>
          <p className="stg-statusbar" aria-hidden="true">
            <span>p</span>
            <span>{skins.tinymce.words}</span>
          </p>
        </div>
      );
    case "discourse":
      return (
        <div className="stg-forum">
          <h4 className="stg-forum-topic">{skins.discourse.topic}</h4>
          <div className="stg-post">
            <Avatar name="Maya" hue={250} />
            <div>
              <p className="stg-post-meta">
                <b>maya</b> <span>{skins.discourse.ago}</span>
              </p>
              <p>{skins.discourse.post}</p>
            </div>
          </div>
          <div className="stg-reply">
            <p className="stg-reply-head">{skins.discourse.replyTo}</p>
            {children}
            <span className="stg-reply-button" aria-hidden="true">
              {skins.discourse.reply}
            </span>
          </div>
        </div>
      );
    case "wordpress":
      return (
        <div className="stg-blog">
          <p className="stg-blog-cat" aria-hidden="true">
            {skins.wordpress.category}
          </p>
          <h4 className="stg-blog-title">{skins.wordpress.post}</h4>
          <p className="stg-blog-excerpt">{skins.wordpress.excerpt}</p>
          <div className="stg-comment">
            <p className="stg-comment-head">{skins.wordpress.comment}</p>
            {children}
            <span className="stg-comment-button" aria-hidden="true">
              {skins.wordpress.submit}
            </span>
          </div>
        </div>
      );
    default:
      return <>{children}</>;
  }
}

/** Fields at the bottom of their window open the list upwards. */
const OPENS_ABOVE: ReadonlySet<ColonSkinId> = new Set(["discourse", "wordpress"]);

/** An editor, forum or blog whose field completes ":" with the real engine. */
export default function ColonSkin({ skin, engine, visible }: SkinProps) {
  const { t, messages } = useStageI18n();
  const id = skin.id as ColonSkinId;
  const words = messages.skins[id];
  const ac = useEmojiAutocomplete(engine);
  const [pressing, setPressing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef(ac);
  useLayoutEffect(() => {
    latest.current = ac;
  });

  const line = `${words.line} `;
  const write = (value: string) => latest.current.edit(value, value.length);
  const auto = useSkinAutoplay({
    root: rootRef,
    visible,
    ready: engine !== undefined,
    async script(run) {
      if (!(await typeText(run, "", `${line}:${skin.query}`, write))) return;
      await highlightAndPick(run, skin.target, () => ({
        results: latest.current.results,
        setActive: latest.current.setActive,
        pick: (result) => latest.current.pick(result.emoji),
        press: setPressing,
      }));
    },
    finish: () => write(`${line}${skin.emoji} `),
    reset: () => latest.current.clear(),
  });

  return (
    <div className={`stg-app stg-app-${id}`} ref={rootRef}>
      <Chrome id={id}>
        <ColonField
          ac={ac}
          engine={engine}
          label={words.label}
          placeholder={t.t("colonPlaceholder")}
          ghostCaret={auto === "playing"}
          pressing={pressing}
          above={OPENS_ABOVE.has(id)}
        />
      </Chrome>
    </div>
  );
}
