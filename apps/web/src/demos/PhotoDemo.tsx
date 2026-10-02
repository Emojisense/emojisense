import {
  type ChangeEvent,
  type DragEvent,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { englishEngine } from "../lib/engine-client";
import { classifyPhoto, downscale, type PhotoReading, UNREADABLE } from "./photo/classify";
import credits from "./photo/credits.json";
import fixtures from "./photo/fixtures.json";
import "./photo.css";

/** How each example appears in the mock channel. Results come from fixtures.json (real API output). */
const POSTS: Record<string, { label: string; alt: string; poster: string; initials: string; time: string }> =
  {
    puppy: {
      label: "Corgi",
      alt: "A corgi puppy standing on its hind legs with its tongue out",
      poster: "Maya Chen",
      initials: "MC",
      time: "9:41 AM",
    },
    cake: {
      label: "Birthday cake",
      alt: "A birthday cake with sprinkles, stars and a lit number 3 candle",
      poster: "Leo Park",
      initials: "LP",
      time: "11:02 AM",
    },
    sunset: {
      label: "Beach sunset",
      alt: "People in the shallows at sunset, one with both arms raised",
      poster: "Ana Souza",
      initials: "AS",
      time: "6:47 PM",
    },
    pizza: {
      label: "Pizza",
      alt: "A sliced mushroom pizza on a wooden board",
      poster: "Sam Okafor",
      initials: "SO",
      time: "7:15 PM",
    },
    cat: {
      label: "Cat on a keyboard",
      alt: "A tabby cat asleep across a computer keyboard",
      poster: "Priya Raman",
      initials: "PR",
      time: "2:30 PM",
    },
    hike: {
      label: "Mountain hike",
      alt: "A hiker on a rocky ridge above misty mountain valleys",
      poster: "Jonas Weber",
      initials: "JW",
      time: "8:05 AM",
    },
  };

interface Photo {
  /** Example id, or "upload" for the visitor's own photo. */
  id: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
  poster: string;
  initials: string;
  time: string;
  reading?: PhotoReading;
  credit?: { author: string; source: string };
}

const EXAMPLES: Photo[] = fixtures.photos.map((photo) => {
  const post = POSTS[photo.id] ?? { label: photo.id, alt: "", poster: "Teammate", initials: "T", time: "" };
  const credit = credits.photos.find((c) => c.id === photo.id);
  return {
    id: photo.id,
    src: photo.src,
    alt: post.alt,
    width: photo.width,
    height: photo.height,
    poster: post.poster,
    initials: post.initials,
    time: post.time,
    reading: photo.response,
    ...(credit ? { credit: { author: credit.author.replace(/\s*\(.*\)$/, ""), source: credit.source } } : {}),
  };
});
const FIRST = EXAMPLES[0] as Photo;

type Status =
  | { kind: "scanning" }
  | { kind: "done"; reading: PhotoReading; source: "example" | "live" | "device"; ms?: number }
  | { kind: "failed"; message: string };

const SHOWN_REACTIONS = 6;
const SCAN_MS = 950;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Text with each emoji in the emoji font. */
function EmojiText({ text }: { text: string }) {
  const parts: { text: string; emoji: boolean }[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const emoji = PICTOGRAPHIC.test(segment);
    const last = parts.at(-1);
    if (last && !emoji && !last.emoji) last.text += segment;
    else parts.push({ text: segment, emoji });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.emoji ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string, never reordered.
          <span key={i} className="emoji">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function statusLabel(status: Status): string {
  if (status.kind === "scanning") return "Reading photo…";
  if (status.kind === "failed") return "API unavailable";
  if (status.source === "live") return `Live · ${((status.ms ?? 0) / 1000).toFixed(1)} s`;
  if (status.source === "device") return "On-device";
  return "Saved API output";
}

/** Photo → caption → emoji: pick an example (real, saved API output) or try your own photo (live API). */
export default function PhotoDemo() {
  const [photo, setPhoto] = useState<Photo>(FIRST);
  const [status, setStatus] = useState<Status>({ kind: "scanning" });
  const [reacted, setReacted] = useState<ReadonlySet<string>>(new Set());
  const [reply, setReply] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [description, setDescription] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const run = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const uploadUrl = useRef<string | undefined>(undefined);
  const dragDepth = useRef(0);
  const id = useId();

  /** Starts a new run: older timers and requests can no longer change the screen. */
  const begin = useCallback((next: Photo) => {
    run.current += 1;
    window.clearTimeout(timer.current);
    request.current?.abort();
    if (uploadUrl.current && uploadUrl.current !== next.src) {
      URL.revokeObjectURL(uploadUrl.current);
      uploadUrl.current = undefined;
    }
    setPhoto(next);
    setReacted(new Set());
    setReply(undefined);
    setNotice("");
    setDescription("");
    feedRef.current?.scrollTo({ top: 0 });
    return run.current;
  }, []);

  const showExample = useCallback(
    (example: Photo) => {
      const token = begin(example);
      const done: Status = { kind: "done", reading: example.reading as PhotoReading, source: "example" };
      if (reducedMotion()) {
        setStatus(done);
        return;
      }
      setStatus({ kind: "scanning" });
      timer.current = window.setTimeout(() => run.current === token && setStatus(done), SCAN_MS);
    },
    [begin],
  );

  // The first example is read when the demo first comes into view (at once with reduced motion).
  useEffect(() => {
    const node = rootRef.current;
    if (!node || reducedMotion() || typeof IntersectionObserver !== "function") {
      showExample(FIRST);
      return;
    }
    const startRun = run.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (run.current === startRun) showExample(FIRST);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [showExample]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      request.current?.abort();
      if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current);
    },
    [],
  );

  useEffect(() => {
    if (!reply) return;
    const feed = feedRef.current;
    feed?.scrollTo({ top: feed.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [reply]);

  const tryOwnPhoto = async (file: File) => {
    let small: Blob;
    try {
      small = await downscale(file);
    } catch {
      setNotice(UNREADABLE);
      return;
    }
    const src = URL.createObjectURL(file);
    const token = begin({
      id: "upload",
      src,
      alt: "Your photo",
      poster: "You",
      initials: "You",
      time: "now",
    });
    uploadUrl.current = src;
    setStatus({ kind: "scanning" });
    const controller = new AbortController();
    request.current = controller;
    const outcome = await classifyPhoto(small, controller.signal);
    if (run.current !== token) return;
    setStatus(
      outcome.ok
        ? { kind: "done", reading: outcome.reading, source: "live", ms: outcome.ms }
        : { kind: "failed", message: outcome.message },
    );
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void tryOwnPhoto(file);
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void tryOwnPhoto(file);
  };

  /** Fallback when the API cannot help: the on-device engine searches the visitor's own words. */
  const describe = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = description.trim();
    if (!text) return;
    const token = run.current;
    try {
      const engine = await englishEngine();
      if (run.current !== token) return;
      const { results } = engine.search(text, { limit: SHOWN_REACTIONS, prefix: false });
      setReacted(new Set());
      setStatus({ kind: "done", reading: { caption: text, reaction: "", results }, source: "device" });
    } catch {
      if (run.current === token) setNotice("The on-device engine could not load. Please try again later.");
    }
  };

  const toggleReaction = (emojiId: string) =>
    setReacted((previous) => {
      const next = new Set(previous);
      if (!next.delete(emojiId)) next.add(emojiId);
      return next;
    });

  const reading = status.kind === "done" ? status.reading : undefined;
  const reactions = reading?.results.slice(0, SHOWN_REACTIONS) ?? [];
  const isUpload = photo.id === "upload";

  return (
    <section
      ref={rootRef}
      className="photo"
      aria-label="Demo: emoji reactions for a photo"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="photo-shell">
        <div className="photo-thread">
          <header className="photo-head">
            <span className="photo-channel">
              <span className="photo-hash" aria-hidden="true">
                #
              </span>
              weekend-pics
            </span>
            <span
              className="photo-pill"
              data-state={status.kind === "done" ? status.source : status.kind}
              aria-live="polite"
            >
              {statusLabel(status)}
            </span>
          </header>

          <div className="photo-feed" ref={feedRef}>
            <article className="photo-msg" key={photo.src}>
              <span className="photo-avatar" aria-hidden="true">
                {photo.initials}
              </span>
              <div className="photo-body">
                <p className="photo-meta">
                  <span className="photo-name">{photo.poster}</span>
                  <span className="photo-time">{photo.time}</span>
                </p>
                <figure className="photo-frame" data-scanning={status.kind === "scanning" || undefined}>
                  <img
                    className="photo-backdrop"
                    src={photo.src}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                  />
                  <img
                    className="photo-image"
                    src={photo.src}
                    alt={photo.alt}
                    width={photo.width}
                    height={photo.height}
                    decoding="async"
                  />
                  <span className="photo-finder" aria-hidden="true" />
                </figure>

                {status.kind !== "failed" && (
                  <p className="photo-caption">
                    <span className="photo-tag">
                      {status.kind === "done" && status.source === "device" ? "You" : "Caption"}
                    </span>
                    {reading ? (
                      <span className="photo-caption-text" key={reading.caption}>
                        {reading.caption}
                      </span>
                    ) : (
                      <span className="photo-skeleton" aria-label="Describing the photo" role="img" />
                    )}
                  </p>
                )}

                {status.kind === "failed" ? (
                  <div className="photo-fallback" role="status">
                    <p>
                      {status.message}{" "}
                      <span>Describe it in a few words and the on-device engine will pick emoji.</span>
                    </p>
                    <form className="photo-describe" onSubmit={describe}>
                      <label className="visually-hidden" htmlFor={`${id}-describe`}>
                        Describe the photo
                      </label>
                      <input
                        id={`${id}-describe`}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="dog at the beach"
                        autoComplete="off"
                        maxLength={64}
                      />
                      <button type="submit">Find emoji</button>
                    </form>
                  </div>
                ) : (
                  <ul className="photo-reactions" aria-label="Suggested reactions">
                    {status.kind === "scanning" &&
                      Array.from({ length: SHOWN_REACTIONS }, (_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
                        <li key={i} className="photo-chip is-skeleton" aria-hidden="true" />
                      ))}
                    {reactions.map((result, i) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          className="photo-chip"
                          aria-pressed={reacted.has(result.id)}
                          aria-label={`React with ${result.emoji}`}
                          style={{ animationDelay: `${i * 45}ms` }}
                          onClick={() => toggleReaction(result.id)}
                        >
                          <span className="emoji">{result.emoji}</span>
                          {reacted.has(result.id) && <span className="photo-count">1</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>

            {reply && (
              <article className="photo-msg is-reply">
                <span className="photo-avatar" aria-hidden="true">
                  You
                </span>
                <div className="photo-body">
                  <p className="photo-meta">
                    <span className="photo-name">You</span>
                    <span className="photo-time">now</span>
                  </p>
                  <p className="photo-text">
                    <EmojiText text={reply} />
                  </p>
                </div>
              </article>
            )}
          </div>

          <div className="photo-compose">
            {(status.kind === "scanning" || (reading?.reaction && !reply)) && (
              <div className="photo-suggest">
                <span className="photo-label">Suggested reply</span>
                {reading?.reaction ? (
                  <button type="button" className="photo-reply" onClick={() => setReply(reading.reaction)}>
                    <EmojiText text={reading.reaction} />
                  </button>
                ) : (
                  <span className="photo-reply is-skeleton" aria-hidden="true" />
                )}
              </div>
            )}
            <div className="photo-composer" aria-hidden="true">
              <span>Message #weekend-pics</span>
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M3.5 10h12M10.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        <fieldset className="photo-picker">
          <legend className="photo-label">Pick a photo</legend>
          <div className="photo-thumbs">
            {EXAMPLES.map((example) => (
              <label key={example.id} className="photo-thumb">
                <input
                  type="radio"
                  name={`${id}-photo`}
                  className="visually-hidden"
                  checked={example.id === photo.id}
                  onChange={() => showExample(example)}
                />
                <img
                  src={example.src}
                  alt={POSTS[example.id]?.label ?? example.id}
                  loading="lazy"
                  decoding="async"
                />
              </label>
            ))}
          </div>
          <p className="photo-credit">
            {!isUpload && photo.credit ? (
              <>
                Photo:{" "}
                <a href={photo.credit.source} target="_blank" rel="noopener noreferrer">
                  {photo.credit.author}
                </a>
                , CC0
              </>
            ) : (
              "Your photo stays on this page."
            )}
          </p>
        </fieldset>

        <div className="photo-upload">
          <label className="photo-drop" data-dragging={dragging || undefined}>
            <input type="file" accept="image/*" className="visually-hidden" onChange={onFile} />
            <span className="photo-drop-icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path
                  d="M10 13V3.5M6 7.5l4-4 4 4M3.5 12.5v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="photo-drop-title">{dragging ? "Drop to read it" : "Try your own photo"}</span>
            <span className="photo-drop-hint">Drop an image here or browse</span>
          </label>
          {notice && (
            <p className="photo-notice" role="status">
              {notice}
            </p>
          )}
          <p className="photo-privacy">
            <svg
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                d="M10 2.5 4 5v4.5c0 3.6 2.5 6.6 6 8 3.5-1.4 6-4.4 6-8V5l-6-2.5Z"
                strokeLinejoin="round"
              />
              <path d="m7.5 10 1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <strong>Photos are never stored.</strong> Your photo is resized to 384 px in your browser,
              captioned in memory, then dropped.
            </span>
          </p>
          <ol className="photo-how">
            <li>A vision model writes a caption and a likely reply.</li>
            <li>Emojisense searches them like a chat message.</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
