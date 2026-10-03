interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_DASHBOARD_URL?: string;
  readonly PUBLIC_PACK_VERSION?: string;
  readonly PUBLIC_PUBLISHABLE_KEY?: string;
  readonly PUBLIC_REPO_URL?: string;
  readonly PUBLIC_INDEXABLE?: string;
  readonly PUBLIC_CF_WEB_ANALYTICS_TOKEN?: string;
  readonly PUBLIC_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
