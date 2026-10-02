import type { AccountRow } from "@emojisense/platform";
import {
  DELETE_ACCOUNT_PHRASE,
  type DeleteAccountResponse,
  isDeleteAccountConfirmed,
  type MeResponse,
} from "../../shared/contract";
import { listMemberships } from "../access";
import { deleteAccount } from "../account-deletion";
import { clearDevCookie, clerkGateway } from "../auth";
import type { AuthedContext } from "../env";
import { HttpError, json, readJsonObject } from "../http";
import { loadAccountPlan, toPlanSummary } from "../plans";
import { toAccountSummary } from "../records";
import { cancelSubscriptionOf, currentBilling } from "./billing";

export async function getMe({ env, account: signedIn, deps }: AuthedContext): Promise<Response> {
  const account = await currentBilling(env.DB, signedIn, deps.now());
  const [{ plan, appCount }, teams] = await Promise.all([
    loadAccountPlan(env.DB, account.id),
    listMemberships(env.DB, account.id),
  ]);
  const body: MeResponse = {
    account: toAccountSummary(account),
    plan: toPlanSummary(plan),
    appCount,
    billingStatus: account.billing_status,
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
 * Server-side deletion of the Clerk user, only when CLERK_SECRET_KEY is set. Best effort: the
 * account is already gone, and without it the SPA deletes the Clerk user with Clerk JS.
 */
async function deleteClerkUser(ctx: AuthedContext): Promise<boolean> {
  const userId = ctx.account.clerk_user_id;
  const deleteUser = clerkGateway(ctx)?.deleteUser;
  if (!userId || !deleteUser) return false;
  try {
    await deleteUser(userId);
    return true;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    console.error(
      JSON.stringify({
        level: "error",
        event: "clerk_user_delete_failed",
        error: (error as Error).name,
        ...(typeof status === "number" ? { status } : {}),
      }),
    );
    return false;
  }
}

/**
 * `DELETE /api/me { confirm }`: deletes the signed-in account and everything it owns, and the
 * Clerk user when the Worker has the secret key. Only the account itself can do this; team roles
 * do not apply.
 */
export async function deleteMe(ctx: AuthedContext): Promise<Response> {
  const { request, url, env, account } = ctx;
  const body = await readJsonObject(request);
  assertConfirmed(account, body.confirm);
  const deleted = await deleteAccount(env.DB, env.EMOJI, account, ctx.deps.now());
  // A deleted account must not keep paying: the subscription ends with its paid period.
  const cancel = cancelSubscriptionOf(ctx, account);
  if (ctx.deps.waitUntil) ctx.deps.waitUntil(cancel);
  else await cancel;
  const clerkUserDeleted = await deleteClerkUser(ctx);
  // Counts only: no ids or emails in logs (docs/API.md, Privacy).
  console.log(JSON.stringify({ event: "account_deleted", ...deleted, clerkUserDeleted }));
  const response: DeleteAccountResponse = { ok: true, clerkUserDeleted };
  return json(response, 200, { "set-cookie": clearDevCookie(url) });
}
