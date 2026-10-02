/**
 * Shadow DOM styles: the "compact" level of docs/DESIGN.md (keycap tiles, emoji-yellow
 * selection, ink outlines, a pill for the query state). Everything is themable through the
 * `--emojisense-*` custom properties and the parts root, search, pill, viewport, listbox, group,
 * group-label, option, image, active, message and sticker. `light-dark()` follows the page, or the
 * host's `color-scheme`.
 */
export const styles: string = /* css */ `
:host {
  --_sun: var(--emojisense-accent, #ffd23f);
  --_ink: var(--emojisense-ink, light-dark(#1e1631, #f5f1ff));
  --_paper: var(--emojisense-background, light-dark(#ffffff, #17121f));
  --_cloud: var(--emojisense-surface, light-dark(#f4f6ff, #221a2e));
  --_muted: var(--emojisense-muted, light-dark(#6b6380, #a79fba));
  --_found: var(--emojisense-found, #12c79c);
  --_none: var(--emojisense-none, #ff5b3a);
  --_focus: var(--emojisense-focus, #3d7bff);
  --_depth-color: var(--emojisense-depth-color, light-dark(#1e1631, #0b0811));
  --_outline: var(--emojisense-outline-width, 0.125rem);
  --_radius: var(--emojisense-radius, 1.25rem);
  --_key-radius: var(--emojisense-key-radius, 0.75rem);
  --_cell: var(--emojisense-cell-size, 2.5rem);
  --_gap: var(--emojisense-gap, 0.25rem);
  --_emoji: var(--emojisense-emoji-size, 1.375rem);
  --_height: var(--emojisense-height, 20rem);
  --_depth: 0 0.1875rem 0 var(--_depth-color);
  --_depth-pressed: 0 0.0625rem 0 var(--_depth-color);
  --_spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  color-scheme: light dark;
  display: inline-block;
  font-family: var(--emojisense-font-family, "Figtree", system-ui, sans-serif);
  font-size: 0.875rem;
}

:host([hidden]) {
  display: none;
}

[hidden] {
  display: none !important;
}

.root {
  display: flex;
  flex-direction: column;
  inline-size: calc(var(--columns) * var(--_cell) + (var(--columns) - 1) * var(--_gap) + 1.5rem);
  max-inline-size: 100%;
  background: var(--_paper);
  color: var(--_ink);
  border: var(--_outline) solid var(--_ink);
  border-radius: var(--_radius);
  box-shadow: 0 0.25rem 0 var(--_depth-color);
  overflow: hidden;
}

.bar {
  position: relative;
  margin: 0.75rem 0.75rem 0.5rem;
}

.search {
  box-sizing: border-box;
  inline-size: 100%;
  padding: 0.5rem 6rem 0.5rem 1rem;
  font: inherit;
  font-weight: 600;
  color: inherit;
  background: var(--_cloud);
  border: var(--_outline) solid var(--_ink);
  border-radius: 999px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.search::-webkit-search-cancel-button {
  -webkit-appearance: none;
}

.search::placeholder {
  color: var(--_muted);
  font-weight: 400;
}

.search:focus-visible {
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--_focus) 40%, transparent);
}

.pill {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 0.375rem;
  translate: 0 -50%;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  border: var(--_outline) solid var(--_ink);
  border-radius: 999px;
  background: var(--_paper);
  pointer-events: none;
}

.pill[data-state="found"] {
  background: color-mix(in srgb, var(--_found) 22%, var(--_paper));
}

.pill[data-state="none"] {
  background: color-mix(in srgb, var(--_none) 18%, var(--_paper));
}

.viewport {
  position: relative;
  block-size: var(--_height);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0.75rem 0.75rem;
}

.group {
  content-visibility: auto;
  contain-intrinsic-size: auto 10rem;
}

.group-label {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  padding: 0.5rem 0.25rem 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--_muted);
  background: var(--_paper);
}

.grid {
  display: grid;
  grid-template-columns: repeat(var(--columns), var(--_cell));
  gap: var(--_gap);
  padding-block-end: 0.25rem;
}

/* Keycaps. In the browse grid they rest flat (1,900 outlined keys would be noise) and pop up
   when active; ranked results always show as keys. */
.option {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  block-size: var(--_cell);
  inline-size: var(--_cell);
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: var(--_emoji);
  line-height: 1;
  border: var(--_outline) solid transparent;
  border-radius: var(--_key-radius);
  cursor: pointer;
  user-select: none;
}

.option img {
  display: block;
  inline-size: 1em;
  block-size: 1em;
  pointer-events: none;
}

:where(#results) .option {
  background: var(--_paper);
  border-color: var(--_ink);
  box-shadow: var(--_depth);
}

.option[aria-selected="true"] {
  background: var(--_sun);
  border-color: var(--_ink);
  box-shadow: var(--_depth);
}

.option:active {
  translate: 0 0.125rem;
  box-shadow: var(--_depth-pressed);
}

.message {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
  color: var(--_muted);
}

.sticker {
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 3rem;
  line-height: 1;
  rotate: -6deg;
  filter: drop-shadow(0 0 0.125rem #fff) drop-shadow(0 0 0.125rem #fff)
    drop-shadow(0 0.25rem 0.25rem rgb(0 0 0 / 0.2));
}

.sticker:empty {
  display: none;
}

@media (prefers-reduced-motion: no-preference) {
  .option {
    transition:
      background-color 120ms ease-out,
      box-shadow 150ms var(--_spring),
      translate 150ms var(--_spring);
  }

  .option:hover {
    animation: wobble 300ms var(--_spring);
  }

  .option[data-new] {
    animation: pop 250ms var(--_spring) both;
    animation-delay: calc(min(var(--i, 0), 12) * 15ms);
  }

  .sticker {
    animation: pop 350ms var(--_spring) both;
  }
}

@keyframes wobble {
  33% {
    rotate: -3deg;
  }
  66% {
    rotate: 3deg;
  }
}

@keyframes pop {
  from {
    scale: 0.4;
    opacity: 0;
  }
  70% {
    scale: 1.08;
    opacity: 1;
  }
  to {
    scale: 1;
  }
}

@media (forced-colors: active) {
  .option[aria-selected="true"] {
    outline: 0.125rem solid Highlight;
  }
}

.visually-hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;
