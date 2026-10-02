import { useEffect, useState } from "react";
import { type AcceptInviteResponse, ApiError, api, errorMessage } from "../api";
import { forgetPendingInvite } from "../lib/pendingInvite";
import { Link } from "../router";
import { useSession } from "../session";
import { roleLabel } from "../ui/Badges";

type InviteState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "joined"; result: AcceptInviteResponse }
  | { status: "error"; message: string };

/** The API's invite codes (docs/API.md), in words that say what to do next. */
const INVITE_ERRORS: Record<string, string> = {
  invite_not_found:
    "This invite link does not exist or was withdrawn. Ask the person who sent it for a new one.",
  invite_used: "This invite link was already used. Each link works once: ask for a new one.",
  invite_expired: "This invite link expired. Links work for 7 days: ask for a new one.",
  invite_own_team: "This invite is for your own team. Send the link to the person you want to invite.",
  already_member: "You are already on this team. Its apps are in your app switcher.",
};

export function InvitePage({ token }: { token: string }) {
  const { me, refresh } = useSession();
  const [state, setState] = useState<InviteState>({ status: "idle" });
  const who = me.account.name ?? me.account.email ?? "your account";

  useEffect(() => {
    document.title = "Team invite · Emojisense dashboard";
    forgetPendingInvite();
  }, []);

  async function accept() {
    setState({ status: "busy" });
    try {
      const result = await api.acceptInvite(token);
      setState({ status: "joined", result });
      await refresh();
    } catch (caught) {
      const known = caught instanceof ApiError ? INVITE_ERRORS[caught.code] : undefined;
      setState({ status: "error", message: known ?? errorMessage(caught) });
    }
  }

  return (
    <main className="auth auth-single">
      <section className="auth-main">
        <Link to="/apps" className="wordmark">
          <span className="wordmark-glyph emoji" aria-hidden="true">
            🦖
          </span>
          <span className="wordmark-word">emojisense</span>
        </Link>
        <div className="auth-card">
          <span className="empty-emoji emoji" aria-hidden="true">
            {state.status === "joined" ? "🎉" : "💌"}
          </span>
          {state.status === "joined" ? (
            <>
              <h1 className="auth-title">
                {state.result.team.ownerName
                  ? `You joined ${state.result.team.ownerName}’s team`
                  : "You joined the team"}
              </h1>
              <p className="page-lede">
                You are a {roleLabel(state.result.team.role).toLowerCase()}. Their apps are in your app
                switcher now.
              </p>
              <Link to="/apps" className="btn btn-primary btn-lg btn-block">
                Go to apps
              </Link>
            </>
          ) : (
            <>
              <h1 className="auth-title">Join a team on Emojisense</h1>
              <p className="page-lede">
                This link adds <strong>{who}</strong> to a team, with the role the invite gives. You can leave
                the team at any time.
              </p>
              {state.status === "error" && (
                <p className="notice notice-error" role="alert">
                  {state.message}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={state.status === "busy"}
                onClick={accept}
              >
                {state.status === "busy" ? "Joining…" : "Accept invite"}
              </button>
              <Link to="/apps" className="btn btn-ghost btn-block">
                Not now
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
