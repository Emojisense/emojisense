import { type EmojiSearchState, useEmojiSearch, useEmojisense } from "@emojisense/react";
import { EmojisensePicker } from "@emojisense/react/frimousse";
import type { SearchResult } from "emojisense";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { type KeywordHit, keywordSearch } from "./keyword-search";
import { median, useReceipt } from "./receipt";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const PACK_VERSION = import.meta.env.VITE_PACK_VERSION ?? "0.1.0";
const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLISHABLE_KEY ?? "pk_demo";
const COLUMNS = 6;

type Locale = "en" | "tr";

const EXAMPLES: Record<Locale, string[]> = {
  en: [
    "jurassic park",
    "lgtm",
    "ship it",
    "greatest of all time",
    "hallowelen",
    "spill the tea",
    "congrats on the launch",
    "break a leg",
  ],
  tr: ["kolay gelsin", "doğum günü", "maşallah", "gülmekten öldüm", "geçmiş olsun", "afiyet olsun"],
};

const COPY = {
  en: {
    lede: "Emoji search that knows what you mean.",
    sub: "Most pickers match the emoji's name. Emojisense also matches slang, typos, films, idioms and intent. It answers on your device first and asks the edge only when it is unsure.",
    label: "Search emoji",
    keyword: "Name search",
    keywordNote: "Substring match on names and keywords, like most pickers",
    ours: "Emojisense",
    oursNote: "Aliases on device, meaning at the edge, fused",
    none: "No match",
    try: "Try",
  },
  tr: {
    lede: "Ne demek istediğini anlayan emoji araması.",
    sub: "Çoğu seçici yalnızca emoji adını eşler. Emojisense argo, yazım hatası, film, deyim ve niyeti de anlar. Önce cihazında yanıt verir, emin değilse kenar sunucuya sorar.",
    label: "Emoji ara",
    keyword: "Ad araması",
    keywordNote: "Ad ve anahtar kelimede alt dize eşleşmesi",
    ours: "Emojisense",
    oursNote: "Cihazda takma adlar, kenarda anlam, birleşik sıralama",
    none: "Sonuç yok",
    try: "Dene",
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
  const receipt = useReceipt(query, search, health?.semantic ? modelKey : undefined);

  useEffect(() => {
    fetch(`${API_URL}/v1/health`)
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth, () => setHealth(undefined));
  }, []);

  const labelOf = (id: string) => {
    const labels = sense.engine?.get(id)?.labels;
    return labels?.[locale] ?? labels?.en ?? "";
  };

  const select = (emoji: string, label: string) => {
    void navigator.clipboard?.writeText(emoji).catch(() => {});
    setAnnouncement(`${emoji} ${label} — ${locale === "tr" ? "kopyalandı" : "copied"}`);
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

  // Show the big answer only when it is probably right: a confident alias hit or a fused result.
  const first = search.results[0];
  const top =
    first && ((search.alias?.confidence ?? 0) >= 0.5 || first.source === "semantic") ? first : undefined;

  return (
    <main className="page">
      <header className="masthead">
        <span className="wordmark">emojisense</span>
        <nav className="locale" aria-label="Language">
          {(["en", "tr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={locale === l}
              onClick={() => {
                setLocale(l);
                setQuery(EXAMPLES[l][0] as string);
                setActiveIndex(0);
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <section className="hero" aria-labelledby="lede">
        <h1 id="lede">{t.lede}</h1>
        <p className="sub">{t.sub}</p>

        <div className="query">
          <label htmlFor="q" className="visually-hidden">
            {t.label}
          </label>
          <input
            id="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={search.results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={search.results.length > 0 ? `${listboxId}-${activeIndex}` : undefined}
            placeholder={EXAMPLES[locale][0]}
          />
          <span className="answer" aria-hidden="true" key={top?.id ?? "none"}>
            {top?.emoji ?? ""}
          </span>
        </div>

        <p className="examples">
          <span>{t.try}</span>
          {EXAMPLES[locale].map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuery(example);
                setActiveIndex(0);
              }}
            >
              {example}
            </button>
          ))}
        </p>
      </section>

      <section className="compare" aria-label="Comparison">
        <KeywordPanel title={t.keyword} note={t.keywordNote} hits={keywordHits} empty={t.none} />
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

      <ReceiptStrip receipt={receipt} health={health} status={sense.status} />

      <section className="picker-section" aria-labelledby="picker-title">
        <div className="picker-copy">
          <h2 id="picker-title">{locale === "tr" ? "Gerçek bir seçicide" : "Inside a real picker"}</h2>
          <p>
            {locale === "tr"
              ? "Frimousse göz atma görünümünü korur. Yazmaya başladığınızda sıralamayı Emojisense yapar."
              : "Frimousse keeps its browse view. As soon as you type, Emojisense does the ranking."}
          </p>
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
          <div className="picker picker-loading">…</div>
        )}
      </section>

      <footer className="footer">
        <p>
          Emoji data: Emojibase (MIT) and Unicode CLDR (Unicode License v3). Glyphs come from your system
          font.
        </p>
      </footer>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </main>
  );
}

/** Code charts label one code point; sequences show their first code point and a "+". */
function shortHex(id: string) {
  const [first, ...rest] = id.split("-").filter((part) => part !== "FE0F");
  return rest.length > 0 ? `${first}+` : (first ?? id);
}

function KeywordPanel(props: { title: string; note: string; hits: KeywordHit[]; empty: string }) {
  return (
    <article className="panel panel-keyword">
      <header>
        <h2>{props.title}</h2>
        <p>{props.note}</p>
      </header>
      {props.hits.length === 0 ? (
        <p className="none">{props.empty}</p>
      ) : (
        <ul className="chart">
          {props.hits.map((hit) => (
            <li key={hit.id} className="cell" title={hit.label}>
              <span className="glyph">{hit.emoji}</span>
              <span className="hex">{shortHex(hit.id)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="count">{props.hits.length}</p>
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
    <article className="panel panel-ours" aria-busy={search.status === "loading"}>
      <header>
        <h2>{props.title}</h2>
        <p>{props.note}</p>
      </header>
      {search.results.length === 0 ? (
        <p className="none">{search.status === "loading" ? "…" : props.empty}</p>
      ) : (
        <div className="chart" role="listbox" id={listboxId} aria-label={props.title}>
          {search.results.map((r, index) => {
            const why = match(r);
            return (
              <div
                key={r.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-label={props.labelOf(r.id)}
                className="cell"
                data-source={r.source}
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
      <p className="count">{search.results.length}</p>
    </article>
  );
}

function ReceiptStrip(props: {
  receipt: ReturnType<typeof useReceipt>;
  health: Health | undefined;
  status: string;
}) {
  const { receipt, health } = props;
  const device = median(receipt.onDeviceMs);
  const edge = median(receipt.edgeMs);
  const perSearch = receipt.searches > 0 ? receipt.costUsd / receipt.searches : undefined;
  const rows: [string, string][] = [
    ["Keystrokes", String(receipt.keystrokes)],
    [
      "Answered on device",
      `${receipt.keystrokes} · median ${device === undefined ? "–" : `${device.toFixed(2)} ms`}`,
    ],
    [
      "Sent to the edge",
      `${receipt.edgeRequests} · median ${edge === undefined ? "–" : `${Math.round(edge)} ms`} · ${receipt.cacheHits} from cache`,
    ],
    [
      "Model",
      health ? `${health.model}${health.semantic ? "" : " (offline: alias only)"}` : "API not reachable",
    ],
  ];
  return (
    <section className="receipt" aria-label="Session receipt">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="total">
        <span>This session</span>
        <strong>${receipt.costUsd.toFixed(9)}</strong>
      </div>
      <p className="projection">
        {perSearch === undefined
          ? "Per 1M searches at this rate: type a few queries"
          : `Per 1M searches at this rate: $${(perSearch * 1e6).toFixed(2)}`}
      </p>
    </section>
  );
}
