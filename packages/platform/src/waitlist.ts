/**
 * The waitlist (`waitlist` table of migrations/0001_init.sql). The dashboard writes it, the website
 * posts to it, and the API Worker's daily cron deletes old rows.
 */

/** A row is deleted this many months after the first sign-up (DECISIONS.md, "Waitlist retention"). */
export const WAITLIST_KEEP_MONTHS = 12;

/** Rows created before this time (epoch ms, UTC) are expired. */
export function waitlistCutoff(now: number): number {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - WAITLIST_KEEP_MONTHS);
  return cutoff.getTime();
}

/** The result of a form post that the website sent without JavaScript. */
export type WaitlistStatus = "ok" | "error";

export const WAITLIST_PAGE_PATH = "/waitlist/";

/**
 * Ids of the website's result messages. The fragment makes the message the CSS `:target`, so the
 * page shows it without JavaScript.
 */
export const WAITLIST_STATUS_ANCHORS: Record<WaitlistStatus, string> = {
  ok: "waitlist-joined",
  error: "waitlist-failed",
};

/** Where the dashboard sends the browser back to after a form post: `/waitlist/?status=…#…`. */
export function waitlistReturnUrl(websiteOrigin: string, status: WaitlistStatus): string {
  return `${websiteOrigin}${WAITLIST_PAGE_PATH}?status=${status}#${WAITLIST_STATUS_ANCHORS[status]}`;
}

/** The `status` query value of the waitlist page, or undefined for anything else. */
export function parseWaitlistStatus(value: string | null | undefined): WaitlistStatus | undefined {
  return value === "ok" || value === "error" ? value : undefined;
}
