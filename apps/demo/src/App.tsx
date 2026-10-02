import { type EmojiSearchState, useEmojiSearch, useEmojisense } from "@emojisense/react";
import { EmojisensePicker } from "@emojisense/react/frimousse";
import type { SearchResult } from "emojisense";
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { type KeywordHit, keywordSearch } from "./keyword-search";
import { type Burst, tiltFor, useBurst, useCountUp } from "./motion";
import { formatMs, type LayerTally, median, type Ticket, useTicket } from "./ticket";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const PACK_VERSION = import.meta.env.VITE_PACK_VERSION ?? "0.1.0";
const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLISHABLE_KEY ?? "pk_demo";
const COLUMNS = 6;

type Locale = "en" | "tr";

interface Example {
  q: string;
  /** Says what kind of language the query is, never the answer. */
  emoji: string;
}

const EXAMPLES: Record<Locale, Example[]> = {
  en: [
    { q: "jurassic park", emoji: "🎬" },
    { q: "lgtm", emoji: "💻" },
    { q: "ship it", emoji: "💻" },
    { q: "greatest of all time", emoji: "🗣️" },
    { q: "hallowelen", emoji: "⌨️" },
    { q: "spill the tea", emoji: "🗣️" },
    { q: "congrats on the launch", emoji: "💬" },
    { q: "break a leg", emoji: "💬" },
  ],
  tr: [
    { q: "kolay gelsin", emoji: "💬" },
    { q: "doğum günü", emoji: "📅" },
    { q: "maşallah", emoji: "💬" },
    { q: "gülmekten öldüm", emoji: "🗣️" },
    { q: "geçmiş olsun", emoji: "💬" },
    { q: "afiyet olsun", emoji: "💬" },
  ],
};

const COPY = {
  en: {
    lede: "Emoji search that knows what you mean.",
    sub: "Most pickers match the emoji’s name. Emojisense also matches slang, typos, films, idioms and intent. It answers on your device first and asks the edge only when it is unsure.",
    label: "Search emoji",
    dice: "Try another example",
    keyword: "Name search",
    keywordNote: "Substring match on names and keywords, like most pickers",
    ours: "Emojisense",
    oursNote: "Aliases on device, meaning at the edge, fused",
    nothing: "Nothing here 🫥 — name search only matches names.",
    none: "No match yet 🫥",
    try: "Try",
    copied: "copied",
    pickerTitle: "Inside a real picker",
    pickerNote: "Frimousse keeps its browse view. As soon as you type, Emojisense does the ranking.",
  },
  tr: {
    lede: "Ne demek istediğini anlayan emoji araması.",
    sub: "Çoğu seçici yalnızca emoji adını eşler. Emojisense argo, yazım hatası, film, deyim ve niyeti de anlar. Önce cihazında yanıt verir, emin değilse kenar sunucuya sorar.",
    label: "Emoji ara",
    dice: "Başka bir örnek dene",
    keyword: "Ad araması",
    keywordNote: "Ad ve anahtar kelimede alt dize eşleşmesi",
    ours: "Emojisense",
    oursNote: "Cihazda takma adlar, kenarda anlam, birleşik sıralama",
    nothing: "Burada bir şey yok 🫥 — ad araması yalnızca adları eşler.",
    none: "Henüz sonuç yok 🫥",
    try: "Dene",
    copied: "kopyalandı",
    pickerTitle: "Gerçek bir seçicide",
    pickerNote: "Frimousse göz atma görünümünü korur. Yazmaya başladığınızda sıralamayı Emojisense yapar.",
  },
} as const;

interface Health {
  model: string;
  semantic: boolean;
}

export function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const [query, setQuery] = useState("jurassic park");
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [health, setHealth] = useState<Health | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const t = COPY[locale];

  const sense = useEmojisense({
    packBaseUrl: `${API_URL}/v1/pack/${PACK_VERSION}`,
    locale,
    endpoint: API_URL,
    publishableKey: PUBLISHABLE_KEY,
  });
  const search = useEmojiSearch(query, sense, { limit: 24 });
  const pack = sense.packs.find((p) => p.locale === locale);
  const keywordHits = useMemo(() => keywordSearch(pack, query), [pack, query]);
  const modelKey = health?.model.split("@")[0];
  const ticket = useTicket(query, search, health?.semantic ? modelKey : undefined);
  const burst = useBurst(search);

  useEffect(() => {
    fetch(`${API_URL}/v1/health`)
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth, () => setHealth(undefined));
  }, []);

  const labelOf = (id: string) => {
    const labels = sense.engine?.get(id)?.labels;
    return labels?.[locale] ?? labels?.en ?? "";
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
  };

  const nextExample = () => {
    const list = EXAMPLES[locale];
    const current = list.findIndex((example) => example.q === query);
    changeQuery(list[(current + 1) % list.length]?.q ?? "");
    inputRef.current?.focus();
  };

  const select = (emoji: string, label: string) => {
    void navigator.clipboard?.writeText(emoji).catch(() => {});
    setAnnouncement(`${emoji} ${label} — ${t.copied}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = search.results.length;
    if (count === 0) return;
    const moves: Record<string, number> = {
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
      ArrowRight: 1,
      ArrowLeft: -1,
    };
    const move = moves[event.key];
    const caretAtEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    if (move !== undefined && (Math.abs(move) === COLUMNS || caretAtEnd)) {
      event.preventDefault();
      setActiveIndex((i) => Math.min(count - 1, Math.max(0, i + move)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = search.results[activeIndex];
      if (result) select(result.emoji, labelOf(result.id));
    }
  };

  // Show the sticker only when the answer is probably right: a confident alias hit or a fused result.
  const first = search.results[0];
  const top =
    first && ((search.alias?.confidence ?? 0) >= 0.5 || first.source === "semantic") ? first : undefined;

  return (
    <>
      <header className="masthead wrap">
        <span className="wordmark">
          <span className="sticker logo" aria-hidden="true">
            🦖
          </span>
          emojisense
        </span>
        <nav className="locale" aria-label="Language">
          {(["en", "tr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className="pill"
              aria-pressed={locale === l}
              onClick={() => {
                setLocale(l);
                changeQuery(EXAMPLES[l][0]?.q ?? "");
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <section className="hero-band" aria-labelledby="lede">
          <div className="wrap">
            <h1 id="lede">{t.lede}</h1>
            <p className="sub">{t.sub}</p>

            <div className="card playground">
              <div className="composer">
                <button
                  type="button"
                  className="keycap dice"
                  onClick={nextExample}
                  aria-label={t.dice}
                  title={t.dice}
                >
                  <span aria-hidden="true">🎲</span>
                </button>
                <label htmlFor="q" className="visually-hidden">
                  {t.label}
                </label>
                <input
                  ref={inputRef}
                  id="q"
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => changeQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  role="combobox"
                  aria-expanded={search.results.length > 0}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    search.results.length > 0 ? `${listboxId}-${activeIndex}` : undefined
                  }
                  placeholder={EXAMPLES[locale][0]?.q}
                />
                <Answer top={top} burst={burst} loading={sense.status === "loading"} />
              </div>

              <div className="examples">
                <span className="examples-label">{t.try}</span>
                <ul>
                  {EXAMPLES[locale].map((example) => (
                    <li key={example.q}>
                      <button
                        type="button"
                        className="pill"
                        aria-pressed={query === example.q}
                        onClick={() => changeQuery(example.q)}
                      >
                        <span className="emoji" aria-hidden="true">
                          {example.emoji}
                        </span>
                        {example.q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="wrap">
          <section className="compare" aria-label="Comparison">
            <KeywordPanel title={t.keyword} note={t.keywordNote} hits={keywordHits} empty={t.nothing} />
            <EmojisensePanel
              title={t.ours}
              note={t.oursNote}
              search={search}
              listboxId={listboxId}
              activeIndex={activeIndex}
              onActive={setActiveIndex}
              onSelect={(r) => select(r.emoji, labelOf(r.id))}
              labelOf={labelOf}
              empty={t.none}
            />
          </section>

          <TicketCard ticket={ticket} health={health} />

          <section className="picker-section" aria-labelledby="picker-title">
            <div className="picker-copy">
              <h2 id="picker-title">{t.pickerTitle}</h2>
              <p>{t.pickerNote}</p>
              <pre className="code">
                <code>{`const sense = useEmojisense({ packBaseUrl, endpoint });

<EmojisensePicker
  emojisense={sense}
  onEmojiSelect={({ emoji }) => insert(emoji)}
/>`}</code>
              </pre>
            </div>
            {sense.engine ? (
              <EmojisensePicker
                className="picker"
                emojisense={sense}
                columns={8}
                onEmojiSelect={({ emoji, label }) => select(emoji, label)}
                empty={<p className="picker-empty">{t.none}</p>}
              />
            ) : (
              <div className="picker picker-loading">⏳</div>
            )}
          </section>

          <footer className="footer">
            <p>
              Emoji data: Emojibase (MIT) and Unicode CLDR (Unicode License v3). Glyphs come from your system
              font.
            </p>
          </footer>
        </div>
      </main>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function Answer(props: { top: SearchResult | undefined; burst: Burst | undefined; loading: boolean }) {
  const { top, burst, loading } = props;
  return (
    <div className="answer" aria-hidden="true">
      {top ? (
        <span key={top.id} className="sticker" style={{ "--tilt": `${tiltFor(top.id)}deg` } as CSSProperties}>
          {top.emoji}
        </span>
      ) : (
        <span className="answer-empty">{loading ? "⏳" : "🫥"}</span>
      )}
      {burst && (
        <span className="burst" key={burst.key}>
          {burst.pieces.map((piece, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces are a fixed, positional set.
              key={index}
              style={
                {
                  "--dx": `${piece.dx}rem`,
                  "--dy": `${piece.dy}rem`,
                  "--r": `${piece.rotate}deg`,
                  "--s": piece.scale,
                  animationDelay: `${piece.delayMs}ms`,
                } as CSSProperties
              }
            >
              {burst.emoji}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Code charts label one code point; sequences show their first code point and a "+". */
function shortHex(id: string) {
  const [first, ...rest] = id.split("-").filter((part) => part !== "FE0F");
  return rest.length > 0 ? `${first}+` : (first ?? id);
}

function KeywordPanel(props: { title: string; note: string; hits: KeywordHit[]; empty: string }) {
  return (
    <article className="card panel">
      <header>
        <h2>{props.title}</h2>
        <p className="panel-note">{props.note}</p>
        <span className="count pill">{props.hits.length}</span>
      </header>
      {props.hits.length === 0 ? (
        <p className="none">{props.empty}</p>
      ) : (
        <ul className="keys">
          {props.hits.map((hit, index) => (
            <li
              key={hit.id}
              className="keycap key"
              title={hit.label}
              style={{ "--i": index } as CSSProperties}
            >
              <span className="glyph">{hit.emoji}</span>
              <span className="hex">{shortHex(hit.id)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

interface EmojisensePanelProps {
  title: string;
  note: string;
  search: EmojiSearchState;
  listboxId: string;
  activeIndex: number;
  onActive: (index: number) => void;
  onSelect: (result: SearchResult) => void;
  labelOf: (id: string) => string;
  empty: string;
}

function EmojisensePanel(props: EmojisensePanelProps) {
  const { search, listboxId, activeIndex } = props;
  const match = (r: SearchResult) =>
    r.source === "alias" ? search.alias?.results.find((a) => a.id === r.id)?.match : undefined;
  return (
    <article className="card panel panel-ours" aria-busy={search.status === "loading"}>
      <header>
        <h2>{props.title}</h2>
        <p className="panel-note">{props.note}</p>
        <span className="count pill">{search.results.length}</span>
      </header>
      {search.results.length === 0 ? (
        <p className="none">{search.status === "loading" ? "⏳" : props.empty}</p>
      ) : (
        <div className="keys" role="listbox" id={listboxId} aria-label={props.title}>
          {search.results.map((r, index) => {
            const why = match(r);
            return (
              // Combobox pattern: focus stays in the input, which moves aria-activedescendant and
              // handles the keys. The options themselves are intentionally not focusable.
              // biome-ignore lint/a11y/useFocusableInteractive: see above.
              // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
              <div
                key={r.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-label={props.labelOf(r.id)}
                className="keycap key"
                data-source={r.source}
                style={{ "--i": index } as CSSProperties}
                onMouseEnter={() => props.onActive(index)}
                onClick={() => props.onSelect(r)}
                title={why ? `“${why}”` : props.labelOf(r.id)}
              >
                <span className="glyph">{r.emoji}</span>
                <span className="hex">{shortHex(r.id)}</span>
                <span className="source" aria-hidden="true">
                  {r.source === "alias" ? "A" : "S"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function Count(props: { value: number; digits?: number }) {
  const shown = useCountUp(props.value);
  return <>{shown.toFixed(props.digits ?? 0)}</>;
}

interface LayerRow {
  emoji: string;
  name: string;
  tally: LayerTally;
  note?: string;
}

function TicketCard(props: { ticket: Ticket; health: Health | undefined }) {
  const { ticket, health } = props;
  const perSearch = ticket.searches > 0 ? ticket.costUsd / ticket.searches : undefined;
  const rows: LayerRow[] = [
    { emoji: "📱", name: "On device", tally: ticket.device },
    { emoji: "🗂️", name: "From shards", tally: ticket.shard },
    {
      emoji: "☁️",
      name: "From the Worker",
      tally: ticket.worker,
      note: ticket.worker.cached > 0 ? `${ticket.worker.cached} cached` : undefined,
    },
  ];
  const model = health
    ? `${health.model}${health.semantic ? "" : " (offline: alias only)"}`
    : "API not reachable";

  return (
    <section className="ticket" aria-labelledby="ticket-title">
      <div className="ticket-body">
        <h2 id="ticket-title">
          <span aria-hidden="true">🎟️</span> Session ticket
        </h2>
        <table>
          <caption className="visually-hidden">Answers per layer, with median latency</caption>
          <thead>
            <tr>
              <th scope="col">Layer</th>
              <th scope="col">Answers</th>
              <th scope="col">Median</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">
                  <span aria-hidden="true">{row.emoji}</span> {row.name}
                  {row.note && <span className="ticket-note"> · {row.note}</span>}
                </th>
                <td>
                  <Count value={row.tally.answers} />
                </td>
                <td>{formatMs(median(row.tally.ms))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl>
          <div>
            <dt>Keystrokes</dt>
            <dd>
              <Count value={ticket.keystrokes} />
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{model}</dd>
          </div>
        </dl>
      </div>
      <div className="ticket-stub">
        <p className="total">
          <span>This session</span>
          <strong>
            $<Count value={ticket.costUsd} digits={9} />
          </strong>
        </p>
        <p className="projection">
          {perSearch === undefined
            ? "Per 1M searches at this rate: type a few queries"
            : `Per 1M searches at this rate: $${(perSearch * 1e6).toFixed(2)}`}
        </p>
      </div>
    </section>
  );
}
