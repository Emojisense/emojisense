import type { ReactNode } from "react";

/** Line icons on a 20 × 20 grid, 1.5 stroke. Monochrome: they take the text color. */
const PATHS = {
  overview: (
    <>
      <rect x="3.25" y="3.25" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.25" y="3.25" width="5.5" height="5.5" rx="1.5" />
      <rect x="3.25" y="11.25" width="5.5" height="5.5" rx="1.5" />
      <rect x="11.25" y="11.25" width="5.5" height="5.5" rx="1.5" />
    </>
  ),
  key: (
    <>
      <circle cx="7" cy="13" r="3.25" />
      <path d="m9.3 10.7 7-7M13.6 6.4l1.9 1.9M11.6 8.4l1.4 1.4" />
    </>
  ),
  smile: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M7.25 11.75c.7 1.15 1.65 1.75 2.75 1.75s2.05-.6 2.75-1.75" />
      <path d="M7.75 8.25h.01M12.25 8.25h.01" strokeWidth="2" />
    </>
  ),
  chart: <path d="M3.5 16.5h13M5.75 13.5V10M10 13.5V5M14.25 13.5V8" />,
  layers: <path d="M10 3.5 3.5 7 10 10.5 16.5 7 10 3.5ZM3.5 10.25 10 13.75l6.5-3.5M3.5 13.5 10 17l6.5-3.5" />,
  building: (
    <path d="M3.5 16.5h13M5 16.5V4.75c0-.7.55-1.25 1.25-1.25h4.5c.7 0 1.25.55 1.25 1.25V16.5M12 8.5h2.75c.7 0 1.25.55 1.25 1.25v6.75M7.75 6.5h1.5M7.75 9.5h1.5M7.75 12.5h1.5" />
  ),
  bolt: <path d="M11 3 4.75 11.25h4.75L9 17l6.25-8.25H10.5L11 3Z" />,
  users: (
    <>
      <circle cx="7.75" cy="7" r="2.75" />
      <path d="M2.75 16c.55-2.5 2.45-4 5-4s4.45 1.5 5 4M13 4.6a2.6 2.6 0 0 1 0 4.8M14.5 12.1c1.45.45 2.4 1.65 2.75 3.9" />
    </>
  ),
  card: (
    <>
      <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="2" />
      <path d="M2.75 8.25h14.5M5.75 12h2.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.5 6h7.25M14.25 6h2.25M3.5 14h2.25M9.25 14h7.25" />
      <circle cx="12.5" cy="6" r="1.75" />
      <circle cx="7.5" cy="14" r="1.75" />
    </>
  ),
  chevrons: <path d="m6.75 7.75 3.25-3.25 3.25 3.25M6.75 12.25 10 15.5l3.25-3.25" />,
  chevronRight: <path d="m8 5 5 5-5 5" />,
  plus: <path d="M10 4.25v11.5M4.25 10h11.5" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="m12.75 12.75 3.5 3.5" />
    </>
  ),
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  copy: (
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.75" />
      <path d="M13 7V5.25c0-.97-.78-1.75-1.75-1.75h-6c-.97 0-1.75.78-1.75 1.75v6c0 .97.78 1.75 1.75 1.75H7" />
    </>
  ),
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  external: (
    <path d="M8.5 4.5H5.25c-.97 0-1.75.78-1.75 1.75v8.5c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V11.5M11.5 3.5h5v5M16.5 3.5 9.25 10.75" />
  ),
  upload: (
    <path d="M10 13V3.75M6.25 7.5 10 3.75l3.75 3.75M3.5 12.5v2.25c0 .97.78 1.75 1.75 1.75h9.5c.97 0 1.75-.78 1.75-1.75V12.5" />
  ),
  trash: (
    <path d="M3.5 5.5h13M8 5.5V4.25c0-.41.34-.75.75-.75h2.5c.41 0 .75.34.75.75V5.5M5 5.5l.7 10.05c.06.8.72 1.45 1.53 1.45h5.54c.81 0 1.47-.64 1.53-1.45L15 5.5" />
  ),
  lock: (
    <>
      <rect x="4.5" y="8.75" width="11" height="8" rx="1.75" />
      <path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" />
    </>
  ),
  signOut: (
    <path d="M8 16.5H5.25c-.97 0-1.75-.78-1.75-1.75v-9.5c0-.97.78-1.75 1.75-1.75H8M12 13.5 15.5 10 12 6.5M15.5 10H8" />
  ),
  book: (
    <path d="M4 15.5V5c0-.83.67-1.5 1.5-1.5H16v11H5.5c-.83 0-1.5.67-1.5 1.5Zm0 0c0 .83.67 1.5 1.5 1.5H16" />
  ),
  send: <path d="M16.5 3.5 8.75 11.25M16.5 3.5 12 16.5l-3.25-5.25L3.5 8l13-4.5Z" />,
  link: (
    <path d="m8.25 11.75 3.5-3.5M9.5 5.75l1.25-1.25a3.18 3.18 0 0 1 4.5 4.5L14 10.25M10.5 14.25 9.25 15.5a3.18 3.18 0 0 1-4.5-4.5L6 9.75" />
  ),
  pencil: <path d="M12.25 4.25 15.75 7.75 7.5 16H4v-3.5l8.25-8.25ZM10.5 6l3.5 3.5" />,
  more: <path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth="2.25" />,
  sparkle: (
    <path d="M10 3.5c.4 3.4 1.9 5.25 6.5 6.5-4.6 1.25-6.1 3.1-6.5 6.5-.4-3.4-1.9-5.25-6.5-6.5 4.6-1.25 6.1-3.1 6.5-6.5Z" />
  ),
  arrowRight: <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />,
  refresh: <path d="M16 10a6 6 0 1 1-1.76-4.24M16 3.75V7h-3.25" />,
  filter: <path d="M3.5 5.5h13M6 10h8M8.5 14.5h3" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
