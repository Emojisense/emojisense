import type { MeResponse } from "../../shared/contract";
import { listMemberships } from "../access";
import type { AuthedContext } from "../env";
import { json } from "../http";
import { loadAccountPlan, toPlanSummary } from "../plans";
import { toAccountSummary } from "../records";
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
