/**
 * An invite opened while signed out. Sign-in may leave the page (a social sign-in through Clerk,
 * dev sign-in), so the token waits in sessionStorage and the app returns to it afterwards. It stays
 * in this tab only.
 */
const KEY = "emojisense:invite";

export function rememberPendingInvite(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Storage blocked: the user can open the link again after signing in.
  }
}

export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetPendingInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
