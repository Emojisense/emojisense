import type { MeResponse } from "../../shared/contract";
import type { AuthedContext } from "../env";
import { json } from "../http";
import { loadAccountPlan, toPlanSummary } from "../plans";
import { toAccountSummary } from "../records";

export async function getMe({ env, account }: AuthedContext): Promise<Response> {
  const { plan, appCount } = await loadAccountPlan(env.DB, account.id);
  const waitlist = account.email
    ? await env.DB.prepare("SELECT plan FROM waitlist WHERE email = ?")
        .bind(account.email)
        .first<{ plan: string | null }>()
    : null;
  const body: MeResponse = {
    account: toAccountSummary(account),
    plan: toPlanSummary(plan),
    appCount,
    waitlistPlan: waitlist ? (waitlist.plan ?? "pro") : null,
  };
  return json(body);
}
