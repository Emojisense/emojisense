import { useId, useState } from "react";
import type { KeySummary } from "../../shared/contract";
import type { App } from "../api";
import { API_URL, PACK_VERSION } from "../lib/config";
import { sessionKey } from "../lib/sessionKeys";
import { Link } from "../router";
import { appHref } from "../routes";
import { CodeBlock } from "../ui/CodeBlock";
import { Icon } from "../ui/Icon";

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
      code: `import {
  createEngine,
  createLayeredSemantic,
  createSearchSession,
  loadPacks,
} from "emojisense";

// On the device: every keystroke, under a millisecond.
const engine = createEngine(
  await loadPacks({ baseUrl: "${API_URL}/v1/pack/${PACK_VERSION}" }),
);

// By meaning, through the API, counted for this app.
const semantic = createLayeredSemantic({
  endpoint: "${API_URL}",
  key: "${publishable}",
});

const session = createSearchSession({
  engine,
  semantic,
  onChange: ({ results }) => render(results),
});
input.oninput = () => session.update(input.value);`,
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
      code: `# From your server, with a secret key.
# Publishable keys answer only their allowed origins.
curl "${API_URL}/v1/search?q=ship+it&limit=8" \\
  -H "Authorization: Bearer ${secret}"`,
    },
  };
}

/**
 * The newest active key of a kind, a prod key before others: its full value if it was created in
 * this tab, else its prefix.
 */
function keyText(keys: KeySummary[], kind: KeySummary["kind"]): { text: string; full: boolean } | null {
  const active = keys.filter((item) => item.kind === kind && item.revokedAt === null);
  const key = active.find((item) => item.environment === "prod") ?? active[0];
  if (!key) return null;
  const full = sessionKey(key.id);
  return full ? { text: full, full: true } : { text: `${key.prefix}…`, full: false };
}

export function QuickStart({ app, keys }: { app: App; keys: KeySummary[] }) {
  const [tab, setTab] = useState<Tab>("browser");
  const baseId = useId();
  const publishable = keyText(keys, "publishable");
  const secret = keyText(keys, "secret");

  if (!publishable && !secret) return <GetStarted app={app} />;

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

/** Before the first key: what is done and what comes next, one action at a time. */
function GetStarted({ app }: { app: App }) {
  const headingId = useId();
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <div>
          <h2 id={headingId} className="card-title">
            Get started
          </h2>
          <p className="card-sub">Three steps to search by meaning in your app.</p>
        </div>
      </div>
      <ol className="steps card-body">
        <li className="step" data-state="done">
          <span className="step-mark" aria-hidden="true">
            <Icon name="check" className="step-check" />
          </span>
          <div className="step-text">
            <strong>Create the app</strong>
            <span>
              {app.name} is ready, with production keys. <span className="visually-hidden">Done.</span>
            </span>
          </div>
        </li>
        <li className="step" data-state="current">
          <span className="step-mark" aria-hidden="true">
            2
          </span>
          <div className="step-text">
            <strong>Create a production key</strong>
            <span>A publishable key for browsers, or a secret key for servers.</span>
            <Link to={appHref(app.id, "keys")} className="btn btn-primary btn-sm">
              <Icon name="plus" />
              Create a key
            </Link>
          </div>
        </li>
        <li className="step">
          <span className="step-mark" aria-hidden="true">
            3
          </span>
          <div className="step-text">
            <strong>Paste the snippet</strong>
            <span>The JavaScript, React and HTTP code shows here, with your key in it.</span>
          </div>
        </li>
      </ol>
    </section>
  );
}
