/**
 * Share cards (Open Graph and X/Twitter). The PNGs in public/og/ are made by
 * scripts/brand-assets.mjs; rerun it when a card's copy, the plans or the engine results change.
 */
export interface ShareImage {
  path: string;
  alt: string;
  width: number;
  height: number;
}

const SIZE = { width: 1200, height: 630 };

export const SHARE_IMAGES = {
  home: {
    path: "/og/home.png",
    alt: "Emojisense: everything emoji, for every app. Searches such as “jurassic park” and “feliz cumpleaños” with their top emoji results.",
    ...SIZE,
  },
  pricing: {
    path: "/og/pricing.png",
    alt: "Emojisense pricing: free to start, fair when you grow. Free, Solo, Pro and Scale plans with their monthly prices.",
    ...SIZE,
  },
  docs: {
    path: "/og/docs.png",
    alt: "Emojisense docs: add emoji search in minutes, with a short code sample and its results.",
    ...SIZE,
  },
} satisfies Record<string, ShareImage>;

/** Pricing and docs pages get their own card; every other page shares the home card. */
export function shareImageFor(path: string): ShareImage {
  if (path.startsWith("/pricing")) return SHARE_IMAGES.pricing;
  if (path.startsWith("/docs")) return SHARE_IMAGES.docs;
  return SHARE_IMAGES.home;
}
