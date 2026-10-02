import { useEffect, useId } from "react";
import { Sticker } from "../components/EmptyState";

/** Codes that the Worker's sign-in routes put in `/?error=`. */
const SIGN_IN_ERRORS: Record<string, string> = {
  github_state: "The sign-in expired or started in another tab. Try again.",
  github_denied: "GitHub sign-in was cancelled. You can try again at any time.",
  github_failed: "GitHub did not confirm the sign-in. Wait a minute and try again.",
  github_unconfigured:
    "GitHub sign-in is not set up on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see the dashboard README).",
};

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

export function SignInPage() {
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
    <main className="signin">
      <div className="card signin-card">
        <Sticker emoji="🔑" large />
        <h1 className="page-title">Sign in to Emojisense</h1>
        <p className="lede">Create apps, get API keys and watch your usage against your plan.</p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <a className="button button-primary" href="/api/auth/github">
          Sign in with GitHub
        </a>
        <p className="hint">We read your GitHub name and verified email. We do not keep a GitHub token.</p>

        {showDevSignIn && (
          <>
            <p className="divider">Local development</p>
            <form className="form" action="/api/auth/dev" method="get">
              <div className="field">
                <label htmlFor={loginId}>Dev user name</label>
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
                <p id={hintId} className="hint">
                  Works only with <code>ENVIRONMENT=development</code>. Use two names to test two accounts.
                </p>
              </div>
              <div className="button-row">
                <button type="submit" className="button">
                  Sign in as dev user
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
