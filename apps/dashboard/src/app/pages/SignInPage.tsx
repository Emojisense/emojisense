import { useEffect, useId } from "react";
import { GitHubMark } from "../ui/Icon";

/** Codes that the Worker's sign-in routes put in `/?error=`. */
const SIGN_IN_ERRORS: Record<string, string> = {
  github_state: "The sign-in expired or started in another tab. Try again.",
  github_denied: "GitHub sign-in was cancelled. You can try again at any time.",
  github_failed: "GitHub did not confirm the sign-in. Wait a minute and try again.",
  github_unconfigured:
    "GitHub sign-in is not set up on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see the dashboard README).",
};

/**
 * Real answers from `GET /v1/search` (pack 0.1.0, local API, October 2026), so the showcase never
 * claims a result the engine does not give.
 */
const SHOWCASE: { query: string; emoji: string[]; note: string }[] = [
  { query: "ship it", emoji: ["🚢", "🚀", "🛳️", "📦", "⚓"], note: "slang" },
  { query: "facepalm", emoji: ["🤦", "🤦‍♂️", "🤦‍♀️", "🙈"], note: "feelings" },
  { query: "feliz cumpleaños", emoji: ["🎂", "🎉", "🥳", "🎈", "🥂"], note: "11 languages" },
  { query: "sleepy monday", emoji: ["😪", "💤", "🥱", "😴", "🛌"], note: "meaning" },
];

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

export function SignInPage({ invite = false }: { invite?: boolean }) {
  const loginId = useId();
  const hintId = useId();
  const errorCode = new URLSearchParams(window.location.search).get("error");
  const error = errorCode ? (SIGN_IN_ERRORS[errorCode] ?? "Sign-in failed. Try again.") : null;
  // The Worker accepts dev sign-in only on localhost, so the form is not shown anywhere else.
  const showDevSignIn = isLocalhost(window.location.hostname);

  useEffect(() => {
    document.title = "Sign in · Emojisense dashboard";
  }, []);

  return (
    <main className="auth">
      <section className="auth-main">
        <a className="wordmark" href="/">
          <span className="wordmark-glyph emoji" aria-hidden="true">
            🦖
          </span>
          <span className="wordmark-word">emojisense</span>
        </a>

        <div className="auth-card">
          <div className="auth-head">
            <h1 className="auth-title">{invite ? "Sign in to join the team" : "Sign in to Emojisense"}</h1>
            <p className="page-lede">
              {invite
                ? "Your invite is waiting. Sign in, and we will take you back to it."
                : "Keys, custom emoji, analytics and usage for every app you build."}
            </p>
          </div>

          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}

          <a className="btn btn-primary btn-lg btn-block" href="/api/auth/github">
            <GitHubMark className="github-mark" />
            Sign in with GitHub
          </a>
          <p className="hint">We read your GitHub name and verified email. We do not keep a GitHub token.</p>

          {showDevSignIn && (
            <form className="auth-dev" action="/api/auth/dev" method="get">
              <p className="auth-divider">
                <span>Local development</span>
              </p>
              <div className="field">
                <label htmlFor={loginId} className="label">
                  Dev user name
                </label>
                <div className="input-group">
                  <input
                    id={loginId}
                    className="input"
                    name="login"
                    defaultValue="dev"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{0,31}"
                    autoComplete="off"
                    aria-describedby={hintId}
                  />
                  <button type="submit" className="btn">
                    Sign in as dev user
                  </button>
                </div>
                <p id={hintId} className="hint">
                  Works only with <code className="code-inline">ENVIRONMENT=development</code>. Each name is
                  its own account.
                </p>
              </div>
            </form>
          )}
        </div>

        <p className="auth-legal hint">
          Emojisense never stores who searched, IP addresses, message text or images.
        </p>
      </section>

      <aside className="auth-aside" aria-label="What the engine answers">
        <div className="auth-showcase">
          <p className="section-label">Live answers from the engine</p>
          <ul className="auth-queries">
            {SHOWCASE.map((row, index) => (
              <li key={row.query} className="auth-query" style={{ animationDelay: `${index * 120}ms` }}>
                <div className="auth-query-head">
                  <span className="auth-query-text">{row.query}</span>
                  <span className="auth-query-note">{row.note}</span>
                </div>
                <div className="auth-query-emoji emoji" role="img" aria-label={`Results for ${row.query}`}>
                  {row.emoji.map((emoji) => (
                    <span key={emoji}>{emoji}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="auth-caption">
            Slang, films, feelings, typos and 11 languages, answered on the device in under a millisecond.
          </p>
        </div>
      </aside>
    </main>
  );
}
