import type { ReactNode } from "react";

/** Monochrome 16-unit line icons. Decorative: the text next to them carries the meaning. */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className ? `chat-icon ${className}` : "chat-icon"}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const HashIcon = () => (
  <Icon>
    <path d="M6.2 2.5 5 13.5M11 2.5 9.8 13.5M2.8 5.8h11M2.2 10.2h11" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="m10.4 10.4 3 3" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const AtIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M10.4 8v.9a1.8 1.8 0 0 0 3.6 0V8A6 6 0 1 0 11.6 12.8" />
  </Icon>
);

export const SmileIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M5.8 9.6c.5.7 1.3 1.1 2.2 1.1s1.7-.4 2.2-1.1" />
    <path d="M6 6.4h.01M10 6.4h.01" strokeWidth="1.8" />
  </Icon>
);

export const FormatIcon = () => (
  <Icon>
    <path d="M2.5 12.5 5.6 4l3.1 8.5M3.6 9.6h4M10.5 8.4a1.9 1.9 0 0 1 3.4 1.1v3M13.9 10.6c-2.1 0-3.4.4-3.4 1.2 0 .6.5 1 1.2 1 1.2 0 2.2-.7 2.2-2.2" />
  </Icon>
);

export const SendIcon = () => (
  <Icon>
    <path d="M8 13V3.4M3.8 7.4 8 3.2l4.2 4.2" strokeWidth="1.7" />
  </Icon>
);

export const SparkleIcon = () => (
  <Icon>
    <path d="M8 2.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4ZM12.5 10.5c.15 1 .5 1.35 1.5 1.5-1 .15-1.35.5-1.5 1.5-.15-1-.5-1.35-1.5-1.5 1-.15 1.35-.5 1.5-1.5Z" />
  </Icon>
);

export const ThreadIcon = () => (
  <Icon>
    <path d="M3 4.2c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v4.6c0 .9-.7 1.6-1.6 1.6H7.2L4.4 13v-2.6h0c-.8 0-1.4-.7-1.4-1.6Z" />
  </Icon>
);

export const MembersIcon = () => (
  <Icon>
    <circle cx="6" cy="5.6" r="2.3" />
    <path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5M10.6 3.5a2.2 2.2 0 0 1 0 4.2M11.8 9.7c1.2.4 2 1.6 2.2 3.3" />
  </Icon>
);
