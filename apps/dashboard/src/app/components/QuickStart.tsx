import { useId, useState } from "react";
import type { KeySummary } from "../../shared/contract";
import type { App } from "../api";
import { API_URL, PACK_VERSION } from "../lib/config";
import { sessionKey } from "../lib/sessionKeys";
import { Link } from "../router";
import { appHref } from "../routes";
import { CodeBlock } from "../ui/CodeBlock";
import { EmptyState } from "../ui/Feedback";

type Tab = "browser" | "react" | "http";

const TABS: { id: Tab; label: string }[] = [
  { id: "browser", label: "JavaScript" },
  { id: "react", label: "React" },
  { id: "http", label: "HTTP" },
];

function snippets(publishable: string, secret: string): Record<Tab, { code: string; lang: "js" | "sh" }> {
  return {
    browser: {
      lang: "js",
      code: `import { createEngine, createLayeredSemantic, createSearchSession, loadPacks } from "emojisense";

// On-device search: answers every keystroke in under a millisecond.
const engine = createEngine(await loadPacks({ baseUrl: "${API_URL}/v1/pack/${PACK_VERSION}" }));

// Meaning search through the API, counted for this app.
const semantic = createLayeredSemantic({ endpoint: "${API_URL}", key: "${publishable}" });

const session = createSearchSession({ engine, semantic, onChange: ({ results }) => render(results) });
input.addEventListener("input", () => session.update(input.value));`,
    },
    react: {
      lang: "js",
      code: `import { useEmojiSearch, useEmojisense } from "@emojisense/react";

const sense = useEmojisense({
  packBaseUrl: "${API_URL}/v1/pack/${PACK_VERSION}",
  endpoint: "${API_URL}",
  publishableKey: "${publishable}",
});
const { results, status } = useEmojiSearch(query, sense);`,
    },
    http: {
      lang: "sh",
      code: `# From your server. Publishable keys only work from their allowed origins.
curl "${API_URL}/v1/search?q=ship+it&limit=8" \\
  -H "Authorization: Bearer ${secret}"`,
    },
  };
}

/** The newest active key of a kind: its full value if it was created in this tab, else its prefix. */
function keyText(keys: KeySummary[], kind: KeySummary["kind"]): { text: string; full: boolean } | null {
  const key = keys.find((item) => item.kind === kind && item.revokedAt === null);
  if (!key) return null;
  const full = sessionKey(key.id);
  return full ? { text: full, full: true } : { text: `${key.prefix}…`, full: false };
}

export function QuickStart({ app, keys }: { app: App; keys: KeySummary[] }) {
  const [tab, setTab] = useState<Tab>("browser");
  const baseId = useId();
  const publishable = keyText(keys, "publishable");
  const secret = keyText(keys, "secret");

  if (!publishable && !secret) {
    return (
      <section className="card" aria-labelledby={`${baseId}-title`}>
        <div className="card-head">
          <h2 id={`${baseId}-title`} className="card-title">
            Quick start
          </h2>
        </div>
        <EmptyState
          emoji="🔑"
          title="No keys yet"
          action={
            <Link to={appHref(app.id, "keys")} className="btn btn-primary">
              Create a key
            </Link>
          }
        >
          Create a publishable key for browsers, then paste the snippet into your picker.
        </EmptyState>
      </section>
    );
  }

  const code = snippets(publishable?.text ?? "pk_live_…", secret?.text ?? "sk_live_…")[tab];
  const shown = tab === "http" ? secret : publishable;

  return (
    <section className="card quickstart" aria-labelledby={`${baseId}-title`}>
      <div className="card-head">
        <div>
          <h2 id={`${baseId}-title`} className="card-title">
            Quick start
          </h2>
          <p className="card-sub">Search with this app’s key in a few lines.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Language">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${baseId}-${item.id}`}
            className="tab"
            aria-selected={tab === item.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const index = TABS.findIndex((entry) => entry.id === tab);
              const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
              if (!next) return;
              setTab(next.id);
              document.getElementById(`${baseId}-${next.id}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${tab}`}
        className="card-body stack"
      >
        <CodeBlock code={code.code} lang={code.lang} mark={shown?.text} label={`${tab} snippet`} />
        <p className="hint">
          {shown?.full
            ? "This is the full key you created in this tab. Store it in your app’s settings; we cannot show it again."
            : shown
              ? "Only the key’s first characters are shown. Paste the full key you saved when you created it."
              : tab === "http"
                ? "Create a secret key for server calls."
                : "Create a publishable key for browser calls."}
        </p>
      </div>
    </section>
  );
}
