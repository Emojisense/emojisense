import {
  type ChangeEvent,
  type DragEvent,
  Fragment,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { type DemoMessages, useDemoI18n } from "../i18n/demos";
import { rich } from "../i18n/react";
import { firstEngine, pageLocale } from "../lib/engine-client";
import { formatClock } from "./chat/content";
import { type ClassifyFailure, classifyPhoto, downscale, type PhotoReading } from "./photo/classify";
import credits from "./photo/credits.json";
import fixtures from "./photo/fixtures.json";
import photoCss from "./photo.css?url";

type PostId = keyof DemoMessages["photo"]["posts"];

/**
 * Who posts each example in the mock channel, and when (minutes after midnight). The label and
 * alt text are in the catalog (demos.photo.posts). Results come from fixtures.json (real API output).
 */
const POSTS: Record<PostId, { poster: string; initials: string; minute: number }> = {
  puppy: { poster: "Maya Chen", initials: "MC", minute: 9 * 60 + 41 },
  cake: { poster: "Leo Park", initials: "LP", minute: 11 * 60 + 2 },
  sunset: { poster: "Ana Souza", initials: "AS", minute: 18 * 60 + 47 },
  pizza: { poster: "Sam Okafor", initials: "SO", minute: 19 * 60 + 15 },
  cat: { poster: "Priya Raman", initials: "PR", minute: 14 * 60 + 30 },
  hike: { poster: "Jonas Weber", initials: "JW", minute: 8 * 60 + 5 },
};

const isPostId = (id: string): id is PostId => id in POSTS;

interface Photo {
  /** Example id, or "upload" for the visitor's own photo. */
  id: string;
  src: string;
  alt: string;
  /** Short name for the thumbnail. */
  label: string;
  width?: number;
  height?: number;
  poster: string;
  initials: string;
  time: string;
  reading?: PhotoReading;
  credit?: { author: string; source: string };
}

function buildExamples(words: DemoMessages["photo"], lang: string): Photo[] {
  return fixtures.photos.map((photo) => {
    const post = isPostId(photo.id) ? POSTS[photo.id] : undefined;
    const text = isPostId(photo.id) ? words.posts[photo.id] : undefined;
    const credit = credits.photos.find((c) => c.id === photo.id);
    return {
      id: photo.id,
      src: photo.src,
      alt: text?.alt ?? "",
      label: text?.label ?? photo.id,
      width: photo.width,
      height: photo.height,
      poster: post?.poster ?? words.teammate,
      initials: post?.initials ?? "T",
      time: post ? formatClock(post.minute, lang) : "",
      reading: photo.response,
      ...(credit
        ? { credit: { author: credit.author.replace(/\s*\(.*\)$/, ""), source: credit.source } }
        : {}),
    };
  });
}

type Status =
  | { kind: "scanning" }
  | { kind: "done"; reading: PhotoReading; source: "example" | "live" | "device"; ms?: number }
  | { kind: "failed"; reason: ClassifyFailure };

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

function statusLabel(status: Status, words: DemoMessages["photo"]["status"], lang: string): string {
  if (status.kind === "scanning") return words.scanning;
  if (status.kind === "failed") return words.failed;
  if (status.source === "live") {
    const seconds = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return words.live.replace("{seconds}", seconds.format((status.ms ?? 0) / 1000));
  }
  if (status.source === "device") return words.device;
  return words.example;
}

/** Photo → caption → emoji: pick an example (real, saved API output) or try your own photo (live API). */
export default function PhotoDemo() {
  const { t, lang, messages } = useDemoI18n();
  const words = messages.photo;
  const examples = useMemo(() => buildExamples(words, lang), [words, lang]);
  const first = examples[0] as Photo;
  const [photo, setPhoto] = useState<Photo>(first);
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
      showExample(first);
      return;
    }
    const startRun = run.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (run.current === startRun) showExample(first);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [showExample, first]);

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
      setNotice(words.errors.unreadable);
      return;
    }
    const src = URL.createObjectURL(file);
    const token = begin({
      id: "upload",
      src,
      alt: words.yourPhoto,
      label: words.yourPhoto,
      poster: words.you,
      initials: words.you,
      time: words.now,
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
        : { kind: "failed", reason: outcome.reason },
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
      const engine = await firstEngine();
      if (run.current !== token) return;
      const { results } = engine.search(text, {
        limit: SHOWN_REACTIONS,
        prefix: false,
        locale: pageLocale(),
      });
      setReacted(new Set());
      setStatus({ kind: "done", reading: { caption: text, reaction: "", results }, source: "device" });
    } catch {
      if (run.current === token) setNotice(words.engineFailed);
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
      aria-label={t.t("photo.region")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <link rel="stylesheet" href={photoCss} precedence="demo" />
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
              {statusLabel(status, words.status, lang)}
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
                      {status.kind === "done" && status.source === "device"
                        ? words.you
                        : t.t("photo.tagCaption")}
                    </span>
                    {reading ? (
                      <span className="photo-caption-text" key={reading.caption}>
                        {reading.caption}
                        {reading.keywords && reading.keywords.length > 0 && (
                          <span className="photo-keywords">
                            <span className="visually-hidden">{t.t("photo.keywords")} </span>
                            {reading.keywords.map((keyword, i) => (
                              <Fragment key={keyword}>
                                {i > 0 && <span aria-hidden="true"> · </span>}
                                <span className="photo-keyword">{keyword}</span>
                              </Fragment>
                            ))}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="photo-skeleton" aria-label={t.t("photo.describing")} role="img" />
                    )}
                  </p>
                )}

                {status.kind === "failed" ? (
                  <div className="photo-fallback" role="status">
                    <p>
                      {words.errors[status.reason]} <span>{t.t("photo.fallback")}</span>
                    </p>
                    <form className="photo-describe" onSubmit={describe}>
                      <label className="visually-hidden" htmlFor={`${id}-describe`}>
                        {t.t("photo.describeLabel")}
                      </label>
                      <input
                        id={`${id}-describe`}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t.t("photo.describePlaceholder")}
                        autoComplete="off"
                        maxLength={64}
                      />
                      <button type="submit">{t.t("photo.find")}</button>
                    </form>
                  </div>
                ) : (
                  <ul className="photo-reactions" aria-label={t.t("photo.suggested")}>
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
                          aria-label={t.t("photo.reactWith", { emoji: result.emoji })}
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
                  {words.you}
                </span>
                <div className="photo-body">
                  <p className="photo-meta">
                    <span className="photo-name">{words.you}</span>
                    <span className="photo-time">{words.now}</span>
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
                <span className="photo-label">{t.t("photo.suggestedReply")}</span>
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
              <span>{t.t("photo.composer", { channel: "weekend-pics" })}</span>
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
          <legend className="photo-label">{t.t("photo.pick")}</legend>
          <div className="photo-thumbs">
            {examples.map((example) => (
              <label key={example.id} className="photo-thumb">
                <input
                  type="radio"
                  name={`${id}-photo`}
                  className="visually-hidden"
                  checked={example.id === photo.id}
                  onChange={() => showExample(example)}
                />
                <img src={example.src} alt={example.label} loading="lazy" decoding="async" />
              </label>
            ))}
          </div>
          <p className="photo-credit">
            {!isUpload && photo.credit
              ? rich(
                  t.raw("photo.credit"),
                  {
                    link: (text) => (
                      <a href={photo.credit?.source} target="_blank" rel="noopener noreferrer">
                        {text}
                      </a>
                    ),
                  },
                  { author: photo.credit.author },
                )
              : t.t("photo.stays")}
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
            <span className="photo-drop-title">{dragging ? t.t("photo.drop") : t.t("photo.try")}</span>
            <span className="photo-drop-hint">{t.t("photo.dropHint")}</span>
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
            <span>{rich(t.raw("photo.privacy"), { strong: (text) => <strong>{text}</strong> })}</span>
          </p>
          <ol className="photo-how">
            <li>{t.t("photo.how1")}</li>
            <li>{t.t("photo.how2")}</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
