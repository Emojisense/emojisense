/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PACK_VERSION?: string;
  readonly VITE_DOCS_URL?: string;
  /** Clerk publishable key (public). Without it the dashboard offers only the localhost dev sign-in. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** "1" serves `/api/*` from fixtures. Development server only. */
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
