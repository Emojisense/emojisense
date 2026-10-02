import { createContext, useContext } from "react";
import type { Me } from "./api";

export interface Session {
  me: Me;
  /** Reloads /api/me, e.g. after an app is created (app count, plan). */
  refresh: () => Promise<void>;
  update: (change: (me: Me) => Me) => void;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a signed-in page");
  return session;
}
