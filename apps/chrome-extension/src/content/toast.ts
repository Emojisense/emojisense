import { placeOverlay } from "./position";
import { SURFACE_CSS } from "./styles";
import { createSurface } from "./surface";
import type { Rect } from "./target";
import type { Theme } from "./theme";

export interface ToastOptions {
  document: Document;
  mount: Element;
  anchor: Rect | null;
  emoji: string;
  message: string;
  /** The page's scheme around the field, as for the picker. */
  theme?: Theme | undefined;
  /** Long enough to read, short enough not to cover the text being typed. */
  durationMs?: number;
}

export interface Toast {
  readonly root: ShadowRoot;
  dismiss(): void;
}

/**
 * A small card next to the caret ("🦖 Copied — press ⌘V to paste"). It never takes focus, so
 * the user can paste right away; it is a polite live region, so screen readers announce it.
 */
export function showToast(options: ToastOptions): Toast {
  const { document: doc } = options;
  const surface = createSurface(doc, options.mount, SURFACE_CSS);
  const card = doc.createElement("div");
  card.className = "surface toast";
  if (options.theme) card.dataset.theme = options.theme;
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  const emoji = doc.createElement("span");
  emoji.className = "toast-emoji";
  emoji.textContent = options.emoji;
  const message = doc.createElement("span");
  message.textContent = options.message;
  card.append(emoji, message);
  surface.root.append(card);

  const view = doc.defaultView;
  if (view) {
    // Layout size, not getBoundingClientRect: the entry animation scales the card.
    const size =
      card.offsetWidth > 0
        ? { width: card.offsetWidth, height: card.offsetHeight }
        : { width: 320, height: 56 };
    const placement = placeOverlay(options.anchor, size, {
      width: view.innerWidth,
      height: view.innerHeight,
    });
    surface.moveTo(placement.top, placement.left);
  }

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(dismiss, options.durationMs ?? 4000);
  function dismiss() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    surface.remove();
  }
  card.addEventListener("click", (event) => {
    // The emoji stays selectable, so a failed copy can still be done by hand.
    if (event.target !== emoji) dismiss();
  });
  return { root: surface.root, dismiss };
}
