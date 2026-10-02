import { getPlan, type PlanId } from "@emojisense/platform";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { useSession } from "../session";
import { useToast } from "../ui/Toast";

/**
 * "Upgrade" records the account on the waitlist for that plan: the billing provider is not
 * chosen yet, so nothing is charged.
 */
export function useUpgrade() {
  const { me, update } = useSession();
  const toast = useToast();
  const [pending, setPending] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(plan: PlanId) {
    setPending(plan);
    setError(null);
    try {
      const result = await api.upgrade(plan);
      update((current) => ({ ...current, waitlistPlan: result.plan }));
      toast(`You are on the ${getPlan(result.plan).name} waitlist`, "🎉");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  const waitlistPlan = me.waitlistPlan ? getPlan(me.waitlistPlan).id : null;
  return { upgrade, pending, error, waitlistPlan };
}
