import type { AliasEngine, SearchResult } from "emojisense";
import {
  type ChangeEvent,
  type DragEvent,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { API_URL, PACK_VERSION } from "../config";
import { classifyPhoto, downscale, type PhotoReading, UNREADABLE } from "../demos/photo/classify";
import credits from "../demos/photo/credits.json";
import fixtures from "../demos/photo/fixtures.json";
import { visitorLocales } from "../lib/engine-client";
import { CodePanel } from "./CodePanel";
import { parseServerTiming, type TimingEntry } from "./lib/edge";
import { formatBytes } from "./lib/format";
import { type CodeSample, photoSnippets } from "./lib/snippets";
import { TimingBars, type TimingRow } from "./TimingBars";

const LIMIT = 8;
const ENDPOINTS = { api: API_URL, packVersion: PACK_VERSION };

const SAMPLE_NAMES: Record<string, string> = {
  puppy: "A corgi puppy standing on its hind legs",
  cake: "A birthday cake with a lit number 3 candle",
  sunset: "People in the sea at sunset",
  pizza: "A sliced mushroom pizza on a board",
  cat: "A tabby cat asleep on a keyboard",
  hike: "A hiker on a ridge above misty valleys",
};

interface Sample {
  id: string;
  src: string;
  alt: string;
  /** Unedited API output, saved by fixtures.json's author with the real API. */
  saved: PhotoReading;
  savedTiming: TimingEntry[];
  credit: Credit | undefined;
}

interface Credit {
  author: string;
  license: string;
  source: string;
}

const SAMPLES: Sample[] = fixtures.photos.map((photo) => {
  const credit = credits.photos.find((c) => c.id === photo.id);
  return {
    id: photo.id,
    src: photo.src,
    alt: SAMPLE_NAMES[photo.id] ?? photo.id,
    saved: photo.response,
    savedTiming: parseServerTiming(photo.serverTiming),
    credit: credit
      ? {
          author: credit.author.replace(/\s*\(.*\)$/, ""),
          license: credit.license.replace(/\s*\(.*\)$/, ""),
          source: credit.source,
        }
      : undefined,
  };
});

interface Shown {
  /** Sample id, or "upload". */
  id: string;
  src: string;
  alt: string;
  credit?: Credit | undefined;
}

interface Sent {
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "reading" }
  | {
      kind: "done";
      reading: PhotoReading;
      via: "live" | "saved" | "device";
      ms?: number;
      serverTiming?: TimingEntry[];
    }
  | { kind: "failed"; message: string };

export interface PhotoLabProps {
  engine: AliasEngine | undefined;
  online: boolean;
  active: boolean;
  codeTab: CodeSample["id"];
  onCodeTab: (id: CodeSample["id"]) => void;
  announce: (message: string) => void;
}

const FIRST = SAMPLES[0];

/** Photo → caption, reply and emoji with `POST /v1/classify-image`. Images are resized here first. */
export function PhotoLab({ engine, online, active, codeTab, onCodeTab, announce }: PhotoLabProps) {
  const [shown, setShown] = useState<Shown | undefined>(FIRST);
  const [status, setStatus] = useState<Status>(
    FIRST
      ? { kind: "done", reading: FIRST.saved, via: "saved", serverTiming: FIRST.savedTiming }
      : { kind: "idle" },
  );
  const [sent, setSent] = useState<Sent | undefined>();
  const [natural, setNatural] = useState<{ width: number; height: number } | undefined>();
  const [broken, setBroken] = useState(false);
  const [notice, setNotice] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const run = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const uploadUrl = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  const begin = useCallback((next: Shown) => {
    run.current += 1;
    request.current?.abort();
    if (uploadUrl.current && uploadUrl.current !== next.src) {
      URL.revokeObjectURL(uploadUrl.current);
      uploadUrl.current = undefined;
    }
    setShown(next);
    setSent(undefined);
    setNatural(undefined);
    setBroken(false);
    setNotice("");
    return run.current;
  }, []);

  useEffect(
    () => () => {
      request.current?.abort();
      if (uploadUrl.current) URL.revokeObjectURL(uploadUrl.current);
    },
    [],
  );

  /** Resize, send, show. A sample that fails falls back to its saved API output. */
  const classify = useCallback(
    async (image: Blob, next: Shown, sample?: Sample) => {
      const token = begin(next);
      setStatus({ kind: "reading" });
      let small: Blob;
      try {
        small = await downscale(image);
        const bitmap = await createImageBitmap(small);
        if (run.current !== token) return;
        setSent({ width: bitmap.width, height: bitmap.height, bytes: small.size, originalBytes: image.size });
        bitmap.close();
      } catch {
        if (run.current === token) setStatus({ kind: "failed", message: UNREADABLE });
        return;
      }
      const fallback = (message: string) => {
        if (!sample) {
          setStatus({ kind: "failed", message });
          return;
        }
        setNotice(`${message} Showing the saved API output for this photo.`);
        setStatus({ kind: "done", reading: sample.saved, via: "saved", serverTiming: sample.savedTiming });
      };
      if (!online) {
        fallback("You are offline.");
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      const outcome = await classifyPhoto(small, controller.signal, LIMIT);
      if (run.current !== token) return;
      if (outcome.ok) {
        setStatus({ kind: "done", reading: outcome.reading, via: "live", ms: outcome.ms });
        announce(`Caption: ${outcome.reading.caption}`);
      } else {
        fallback(outcome.message);
      }
    },
    [begin, online, announce],
  );

  const runSample = async (sample: Sample) => {
    const next = { id: sample.id, src: sample.src, alt: sample.alt, credit: sample.credit };
    try {
      const response = await fetch(sample.src);
      await classify(await response.blob(), next, sample);
    } catch {
      begin(next);
      setStatus({ kind: "done", reading: sample.saved, via: "saved", serverTiming: sample.savedTiming });
    }
  };

  const runFile = useCallback(
    (file: File) => {
      const src = URL.createObjectURL(file);
      // `classify` starts a new run synchronously, which revokes the previous upload's URL first.
      void classify(file, { id: "upload", src, alt: "Your photo" });
      uploadUrl.current = src;
    },
    [classify],
  );

  // Paste an image anywhere while this tab is open.
  useEffect(() => {
    if (!active) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      runFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active, runFile]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) runFile(file);
  };
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) runFile(file);
  };

  /** Without the API, the on-device engine searches the visitor's own words for the photo. */
  const describe = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = description.trim();
    if (!text || !engine) return;
    const startedAt = performance.now();
    const { results } = engine.search(text, { limit: LIMIT, prefix: false, locales: visitorLocales() });
    setStatus({
      kind: "done",
      reading: { caption: text, reaction: "", results },
      via: "device",
      ms: performance.now() - startedAt,
    });
  };

  const snippets = useMemo(() => photoSnippets({ limit: LIMIT }, ENDPOINTS), []);
  const reading = status.kind === "done" ? status.reading : undefined;
  const label = (result: { id: string; emoji: string }) => engine?.get(result.id)?.labels.en ?? result.emoji;
  const sample = SAMPLES.find((s) => s.id === shown?.id);

  const rows: TimingRow[] =
    status.kind !== "done"
      ? [{ label: "Round trip", note: status.kind === "reading" ? "reading…" : "–" }]
      : status.via === "device"
        ? [{ label: "On device", ms: status.ms, tone: "device" }]
        : [
            ...(status.ms !== undefined ? [{ label: "Round trip", ms: status.ms }] : []),
            ...(status.serverTiming ?? []).map((entry) => ({
              label: `Server: ${entry.name}`,
              ms: entry.ms,
              nested: status.ms !== undefined,
            })),
          ];

  return (
    <div className="pg-photo">
      <div className="pg-split">
        <section
          className="pg-panel pg-dropzone"
          aria-label="Photo"
          data-dragging={dragging || undefined}
          onDragEnter={(event) => hasFiles(event) && setDragging(true)}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <header className="pg-panel-head">
            <h2 className="pg-label">Photo</h2>
            <span className="pg-count">resized to 384 px here, never stored</span>
          </header>
          <figure className="pg-figure" data-reading={status.kind === "reading" || undefined}>
            {shown && !broken ? (
              <img
                key={shown.src}
                src={shown.src}
                alt={shown.alt}
                decoding="async"
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => setBroken(true)}
              />
            ) : (
              <span className="emoji pg-empty-emoji" aria-hidden="true">
                🖼️
              </span>
            )}
            <span className="pg-scan" aria-hidden="true" />
          </figure>
          <p className="pg-meta">
            {sent ? (
              <>
                Sent{" "}
                <strong>
                  {sent.width} × {sent.height}
                </strong>{" "}
                JPEG · {formatBytes(sent.bytes)}
                {natural && (
                  <span className="pg-quiet">
                    {" "}
                    from {natural.width} × {natural.height} · {formatBytes(sent.originalBytes)}
                  </span>
                )}
              </>
            ) : status.kind === "done" && status.via === "saved" ? (
              "Saved API output. Run it live, pick another photo, or use your own."
            ) : (
              "Choose, drop or paste a photo."
            )}
            {shown?.credit && (
              <a className="pg-quiet pg-credit" href={shown.credit.source} rel="noopener">
                Photo: {shown.credit.author} · {shown.credit.license}
              </a>
            )}
          </p>
          <div className="pg-actions">
            <button
              type="button"
              className="pg-button pg-button-primary"
              onClick={() => fileInput.current?.click()}
            >
              Choose a photo
            </button>
            {sample && (
              <button
                type="button"
                className="pg-button"
                disabled={status.kind === "reading"}
                onClick={() => void runSample(sample)}
              >
                Run live
              </button>
            )}
            <span className="pg-quiet pg-hint">or drop or paste an image</span>
            <input
              ref={fileInput}
              id={`${id}-file`}
              className="visually-hidden"
              type="file"
              accept="image/*"
              tabIndex={-1}
              onChange={onFile}
            />
          </div>
          <fieldset className="pg-samples">
            <legend className="visually-hidden">Sample photos</legend>
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="pg-sample"
                aria-pressed={shown?.id === s.id}
                aria-label={`Run live: ${s.alt}`}
                onClick={() => void runSample(s)}
              >
                <img src={s.src} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </fieldset>
        </section>

        <div className="pg-stack">
          <section className="pg-panel pg-reading" aria-label="Result" aria-busy={status.kind === "reading"}>
            <header className="pg-panel-head">
              <h2 className="pg-label">Result</h2>
              <span className="pg-count" data-state={status.kind === "done" ? status.via : status.kind}>
                {statusLabel(status)}
              </span>
            </header>
            {notice && (
              <p className="pg-notice" role="status">
                {notice}
              </p>
            )}
            {status.kind === "failed" ? (
              <div className="pg-fallback" role="status">
                <p>
                  {status.message} Describe the photo in a few words, and the on-device dictionary picks
                  emoji.
                </p>
                <form className="pg-inline-form" onSubmit={describe}>
                  <label className="visually-hidden" htmlFor={`${id}-describe`}>
                    Describe the photo
                  </label>
                  <input
                    id={`${id}-describe`}
                    className="pg-input"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="dog at the beach"
                    autoComplete="off"
                    maxLength={64}
                  />
                  <button type="submit" className="pg-button" disabled={!engine}>
                    Find emoji
                  </button>
                </form>
              </div>
            ) : (
              <dl className="pg-facts pg-facts-wide">
                <div>
                  <dt>{status.kind === "done" && status.via === "device" ? "Your words" : "Caption"}</dt>
                  <dd className="pg-caption">
                    {reading ? reading.caption : <span className="pg-skeleton pg-skeleton-line" />}
                  </dd>
                </div>
                {status.kind !== "done" || status.via !== "device" ? (
                  <div>
                    <dt>Reply</dt>
                    <dd>
                      {reading ? (
                        reading.reaction ? (
                          <span className="pg-bubble">
                            <EmojiText text={reading.reaction} />
                          </span>
                        ) : (
                          "–"
                        )
                      ) : (
                        <span className="pg-skeleton pg-skeleton-line pg-skeleton-short" />
                      )}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Emoji</dt>
                  <dd>
                    <ul className="pg-emoji-row" aria-label="Suggested emoji">
                      {reading
                        ? reading.results.map((result) => (
                            <li key={result.id} title={label(result)}>
                              <span className="emoji">{result.emoji}</span>
                              <span className="pg-mono">{scoreOf(result)}</span>
                            </li>
                          ))
                        : Array.from({ length: 6 }, (_, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
                            <li key={i} className="pg-skeleton" aria-hidden="true" />
                          ))}
                    </ul>
                  </dd>
                </div>
              </dl>
            )}
          </section>
          <section className="pg-panel" aria-label="Timing">
            <header className="pg-panel-head">
              <h2 className="pg-label">Timing</h2>
              <span className="pg-count">
                {status.kind === "done" && status.via === "saved" ? "server times when saved" : "this photo"}
              </span>
            </header>
            <TimingBars rows={rows} label="Time per step for this photo" />
          </section>
        </div>
      </div>

      <CodePanel title="Copy as code" samples={snippets} selected={codeTab} onSelect={onCodeTab} />
    </div>
  );
}

/** The API sends a score with each emoji; `PhotoReading` keeps only emoji and id in its type. */
function scoreOf(result: object): string {
  const score = (result as Partial<SearchResult>).score;
  return typeof score === "number" ? score.toFixed(2) : "";
}

function statusLabel(status: Status): string {
  if (status.kind === "reading") return "Reading the photo…";
  if (status.kind === "failed") return "Not available";
  if (status.kind === "idle") return "";
  if (status.via === "live") return "Live";
  if (status.via === "device") return "On device";
  return `Saved API output · ${fixtures.madeOn}`;
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Text with each emoji in the emoji font. */
function EmojiText({ text }: { text: string }) {
  return (
    <>
      {[...graphemes.segment(text)].map(({ segment, index }) =>
        PICTOGRAPHIC.test(segment) ? (
          <span key={index} className="emoji">
            {segment}
          </span>
        ) : (
          segment
        ),
      )}
    </>
  );
}
