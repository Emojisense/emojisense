/**
 * Clerk in the SPA: ClerkProvider, the bridge that hands Clerk's session token to the API client,
 * and the sign-in form. The Worker verifies the token (src/worker/clerk.ts).
 */
import { ClerkProvider, type ClerkProviderProps, SignIn, useAuth, useClerk } from "@clerk/react";
import { type ReactNode, useLayoutEffect, useMemo } from "react";
import { setTokenSource } from "../api";
import { navigate } from "../router";
import { type AuthAdapter, AuthContext } from "./context";

/**
 * Clerk's components drawn with the dashboard's own tokens (tokens.css), so they follow light and
 * dark mode and stay calm: near-monochrome, and the emoji are the only color.
 */
const APPEARANCE: NonNullable<ClerkProviderProps["appearance"]> = {
  variables: {
    colorPrimary: "var(--accent)",
    colorPrimaryForeground: "var(--on-accent)",
    colorBackground: "var(--bg)",
    colorForeground: "var(--ink)",
    colorMuted: "var(--bg-soft)",
    colorMutedForeground: "var(--ink-2)",
    colorNeutral: "var(--ink)",
    colorInput: "var(--bg)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--line-strong)",
    colorRing: "var(--focus)",
    colorDanger: "var(--bad)",
    colorSuccess: "var(--good)",
    colorModalBackdrop: "var(--overlay)",
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
    fontFamilyMono: "var(--font-mono)",
    fontSize: "var(--text-base)",
    borderRadius: "var(--radius-sm)",
  },
  options: {
    logoPlacement: "none",
    socialButtonsVariant: "blockButton",
    // The sign-in sits inside the dashboard's own card.
    elevation: "flush",
    shimmer: false,
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "none" },
  },
};

/** Clerk moves inside the SPA with the app's router; other origins (OAuth providers) load as pages. */
function clerkNavigate(to: string, replace: boolean): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  navigate(`${url.pathname}${url.search}${url.hash}`, { replace });
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, userId, getToken, signOut } = useAuth();
  const clerk = useClerk();

  // A layout effect runs before the app's effects, so the first API call already has the token.
  useLayoutEffect(() => {
    setTokenSource(() => getToken());
    return () => setTokenSource(null);
  }, [getToken]);

  const adapter = useMemo<AuthAdapter>(
    () => ({
      provider: "clerk",
      loaded: isLoaded,
      userId: userId ?? null,
      signOut: () => signOut(),
      deleteUser: async () => {
        const user = clerk.user;
        if (!user) return;
        if (!user.deleteSelfEnabled) {
          throw new Error("Clerk does not allow users to delete themselves on this instance.");
        }
        await user.delete();
      },
      openProfile: () => clerk.openUserProfile(),
    }),
    [isLoaded, userId, signOut, clerk],
  );

  return <AuthContext.Provider value={adapter}>{children}</AuthContext.Provider>;
}

export function ClerkAuth({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={APPEARANCE}
      telemetry={false}
      // One page signs in and signs up (combined flow); the app then routes from "/".
      signInUrl="/"
      signUpUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
      routerPush={(to) => clerkNavigate(to, false)}
      routerReplace={(to) => clerkNavigate(to, true)}
    >
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

/** Clerk's sign-in and sign-up form. Hash routing keeps its steps on the current page. */
export function ClerkSignIn() {
  return (
    <div className="auth-clerk">
      <SignIn routing="hash" withSignUp fallback={<div className="auth-clerk-loading" aria-busy="true" />} />
    </div>
  );
}
