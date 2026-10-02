import { useEffect, useState } from "react";
import type { AdminStatusResponse } from "../../shared/contract";
import { api } from "../api";
import { useSession } from "../session";

/** One request per signed-in account and page load: the answer only changes with a deploy. */
const statusByAccount = new Map<string, Promise<AdminStatusResponse>>();

const NOT_ADMIN: AdminStatusResponse = { admin: false, culture: false };

/** Whether the internal pages show (ADMIN_EMAILS); null until the API has answered. */
export function useAdminStatus(): AdminStatusResponse | null {
  const { me } = useSession();
  const accountId = me.account.id;
  const [status, setStatus] = useState<AdminStatusResponse | null>(null);

  useEffect(() => {
    let current = true;
    let loading = statusByAccount.get(accountId);
    if (!loading) {
      loading = api.adminStatus().catch(() => NOT_ADMIN);
      statusByAccount.set(accountId, loading);
    }
    void loading.then((value) => current && setStatus(value));
    return () => {
      current = false;
    };
  }, [accountId]);

  return status;
}
