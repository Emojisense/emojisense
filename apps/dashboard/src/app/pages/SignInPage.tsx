import { PLANS } from "@emojisense/platform";
import { type ReactNode, useEffect, useId } from "react";
import { ClerkSignIn } from "../auth/ClerkAuth";
import { useAuthAdapter } from "../auth/context";
import type { CheckoutIntent } from "../lib/checkoutIntent";
import { MOCK_MODE } from "../lib/config";

/**
 * Real answers from `GET /v1/search` (pack 0.1.0, local API, October 2026), so the showcase never
 * claims a result the engine does not give.
 */
const SHOWCASE: { query: string; emoji: string[]; note: string }[] = [
  { query: "ship it", emoji: ["🚢", "🚀", "🛳️", "📦", "⚓"], note: "slang" },
  { query: "facepalm", emoji: ["🤦", "🤦‍♂️", "🤦‍♀️", "🙈"], note: "feelings" },
  { query: "feliz cumpleaños", emoji: ["🎂", "🎉", "🥳", "🎈", "🥂"], note: "Spanish, by meaning" },
  { query: "sleepy monday", emoji: ["😪", "💤", "🥱", "😴", "🛌"], note: "phrases" },
];

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function Wordmark() {
  return (
    <a className="wordmark" href="/">
      <span className="wordmark-glyph emoji" aria-hidden="true">
        🦖
      </span>
      <span className="wordmark-word">emojisense</span>
    </a>
  );
}

/** The Worker accepts dev sign-in only on localhost with ENVIRONMENT=development. */
function DevSignIn() {
  const loginId = useId();
  const hintId = useId();
  return (
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
          Works only with <code className="code-inline">ENVIRONMENT=development</code>. Each name is its own
          account.
        </p>
      </div>
    </form>
  );
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-main">
        <Wordmark />
        <div className="auth-card">{children}</div>
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
            Slang, feelings, phrases and 11 languages: on the device first, by meaning when it needs to.
          </p>
        </div>
      </aside>
    </main>
  );
}

function localLede(showDevSignIn: boolean): string {
  if (MOCK_MODE) return "Mock mode answers from fixtures. Use the dev sign-in below.";
  return showDevSignIn
    ? "Clerk is not set up in this build, so only the dev sign-in below works. Set VITE_CLERK_PUBLISHABLE_KEY (see the dashboard README)."
    : "Sign-in is not set up on this server yet. Try again later.";
}

export function SignInPage({
  invite = false,
  checkout = null,
}: {
  invite?: boolean;
  /** A plan picked on the website: after sign-in, Billing opens with it. */
  checkout?: CheckoutIntent | null;
}) {
  const { provider } = useAuthAdapter();
  const showDevSignIn = isLocalhost(window.location.hostname);

  useEffect(() => {
    document.title = "Sign in · Emojisense dashboard";
  }, []);

  return (
    <AuthLayout>
      {invite && (
        <p className="notice">
          <span className="emoji" aria-hidden="true">
            💌
          </span>
          <span>Your invite is waiting. Sign in, and we will take you back to it.</span>
        </p>
      )}
      {!invite && checkout && (
        <p className="notice">
          <span className="emoji" aria-hidden="true">
            🛒
          </span>
          <span>
            Sign in or create an account, and we will take you to checkout for {PLANS[checkout.plan].name}.
          </span>
        </p>
      )}
      {provider === "clerk" ? (
        <ClerkSignIn />
      ) : (
        <div className="auth-head">
          <h1 className="auth-title">Sign in to Emojisense</h1>
          <p className="page-lede">{localLede(showDevSignIn)}</p>
        </div>
      )}
      {showDevSignIn && <DevSignIn />}
    </AuthLayout>
  );
}

/** Clerk has a session, but the dashboard API does not accept it. */
export function SessionRejectedPage({
  message,
  onRetry,
  onSignOut,
}: {
  message?: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  useEffect(() => {
    document.title = "Sign-in problem · Emojisense dashboard";
  }, []);

  return (
    <main className="auth auth-single">
      <section className="auth-main">
        <Wordmark />
        <div className="auth-card">
          <span className="empty-emoji emoji" aria-hidden="true">
            🔐
          </span>
          <h1 className="auth-title">We could not open your account</h1>
          <p className="page-lede" role="alert">
            {message ??
              "You are signed in, but the dashboard did not accept the sign-in. Try again, or sign out and sign in once more."}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onSignOut}>
              Sign out
            </button>
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
