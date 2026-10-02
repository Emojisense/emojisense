import type { AccountRow } from "@emojisense/platform";
import {
  DELETE_ACCOUNT_PHRASE,
  isDeleteAccountConfirmed,
  type MeResponse,
  type OkResponse,
} from "../../shared/contract";
import { listMemberships } from "../access";
import { deleteAccount } from "../account-deletion";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { loadAccountPlan, toPlanSummary } from "../plans";
import { toAccountSummary } from "../records";
import { clearSessionCookie } from "../session";
import { readWaitlistPlan } from "./billing";

export async function getMe({ env, account }: AuthedContext): Promise<Response> {
  const [{ plan, appCount }, waitlistPlan, teams] = await Promise.all([
    loadAccountPlan(env.DB, account.id),
    readWaitlistPlan(env.DB, account.email),
    listMemberships(env.DB, account.id),
  ]);
  const body: MeResponse = {
    account: toAccountSummary(account),
    plan: toPlanSummary(plan),
    appCount,
    waitlistPlan,
    teams,
  };
  return json(body);
}

/** The person must type the account's email (any case), or the phrase when there is no email. */
function assertConfirmed(account: AccountRow, confirm: unknown): void {
  if (isDeleteAccountConfirmed(account.email, confirm)) return;
  throw new HttpError(
    400,
    "confirmation_required",
    account.email
      ? "To delete the account, send its email address in confirm."
      : `To delete the account, send "${DELETE_ACCOUNT_PHRASE}" in confirm.`,
    "confirm",
  );
}

/**
 * `DELETE /api/me { confirm }`: deletes the signed-in account and everything it owns, then clears
 * the session cookie. Only the account itself can do this; team roles do not apply.
 */
export async function deleteMe({ request, url, env, account }: AuthedContext): Promise<Response> {
  const body = await readJsonObject(request);
  assertConfirmed(account, body.confirm);
  const deleted = await deleteAccount(env.DB, env.EMOJI, account);
  // Counts only: no ids or emails in logs (docs/API.md, Privacy).
  console.log(JSON.stringify({ event: "account_deleted", ...deleted }));
  const response: OkResponse = { ok: true };
  return json(response, 200, { "set-cookie": clearSessionCookie(url) });
}
