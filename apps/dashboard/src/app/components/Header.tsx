import { useState } from "react";
import { Link } from "../router";
import { useSession } from "../session";

export function Header() {
  const { me, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const who = me.account.name ?? me.account.email ?? "Signed in";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/apps" className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">
            🦖
          </span>
          Emojisense <span className="wordmark-tag">dashboard</span>
        </Link>
        <div className="account">
          <span className="account-name" title={who}>
            {who}
          </span>
          <button
            type="button"
            className="button button-small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
