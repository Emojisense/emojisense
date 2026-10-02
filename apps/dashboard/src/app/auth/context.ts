import { createContext, useContext } from "react";

/**
 * The sign-in provider as the app sees it. With a Clerk publishable key at build time it is Clerk
 * (ClerkAuth.tsx); without one, or in mock mode, it is "local": only the localhost dev sign-in.
 */
export interface AuthAdapter {
  provider: "clerk" | "local";
  /** False until Clerk has loaded. */
  loaded: boolean;
  /** The Clerk user id while Clerk has a session. */
  userId: string | null;
  /** Ends the Clerk session. */
  signOut: () => Promise<void>;
  /** Deletes the Clerk user (after `DELETE /api/me`). Throws when Clerk refuses. */
  deleteUser: () => Promise<void>;
  /** Opens Clerk's profile dialog (name, email, password, connected accounts). */
  openProfile: (() => void) | null;
}

export const LOCAL_AUTH: AuthAdapter = {
  provider: "local",
  loaded: true,
  userId: null,
  signOut: async () => {},
  deleteUser: async () => {},
  openProfile: null,
};

export const AuthContext = createContext<AuthAdapter>(LOCAL_AUTH);

export function useAuthAdapter(): AuthAdapter {
  return useContext(AuthContext);
}
