import type { ReactNode } from "react";
import type { ToolName } from "./mcp";

/** Decorative 16 × 16 line icons; the text next to them carries the meaning. */
function Icon({
  children,
  weight = 1.5,
  className,
}: {
  children: ReactNode;
  weight?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** A neutral mark for the generic assistant: a ring with a satellite. */
export function AssistantMark() {
  return (
    <Icon weight={1.75}>
      <circle cx="7.5" cy="8.5" r="4.25" />
      <circle cx="12.25" cy="3.75" r="1.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ToolIcon({ name }: { name: ToolName }) {
  if (name === "search_emoji") {
    return (
      <Icon>
        <circle cx="7" cy="7" r="4" />
        <path d="m10 10 3.5 3.5" />
      </Icon>
    );
  }
  if (name === "emoji_for_text") {
    return (
      <Icon>
        <path d="M2.5 4h11M2.5 8h7M2.5 12h5" />
        <circle cx="12.5" cy="11.5" r="1.75" />
      </Icon>
    );
  }
  return (
    <Icon>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.75 9.5c.55.8 1.3 1.25 2.25 1.25s1.7-.45 2.25-1.25" />
      <path d="M6 6.25v.5M10 6.25v.5" strokeWidth={1.75} />
    </Icon>
  );
}

export function Chevron() {
  return (
    <Icon className="assistant-chevron">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </Icon>
  );
}

export function SendArrow() {
  return (
    <Icon weight={1.75}>
      <path d="M8 12.5v-9M4 7.5l4-4 4 4" />
    </Icon>
  );
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.75" />
      <path d="M10.5 3.25A1.75 1.75 0 0 0 8.75 2H4a2 2 0 0 0-2 2v4.75a1.75 1.75 0 0 0 1.25 1.68" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon weight={1.75}>
      <path d="m3.5 8.5 3 3 6-6.5" />
    </Icon>
  );
}
