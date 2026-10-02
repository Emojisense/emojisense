import overlayCss from "./overlay.css?raw";
import { placeOverlay } from "./position";
import { createSurface } from "./surface";
import type { Rect } from "./target";

export interface ToastOptions {
  document: Document;
  mount: Element;
  anchor: Rect | null;
  emoji: string;
  message: string;
  /** Long enough to read, short enough not to cover the text being typed. */
  durationMs?: number;
}

export interface Toast {
  readonly root: ShadowRoot;
  dismiss(): void;
}

/**
 * A sticker card next to the caret ("🦖 Copied — press ⌘V to paste"). It never takes focus, so
 * the user can paste right away; it is a polite live region, so screen readers announce it.
 */
export function showToast(options: ToastOptions): Toast {
  const { document: doc } = options;
  const surface = createSurface(doc, options.mount, overlayCss);
  const card = doc.createElement("div");
  card.className = "surface toast";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  const sticker = doc.createElement("span");
  sticker.className = "sticker";
  sticker.textContent = options.emoji;
  const message = doc.createElement("span");
  message.textContent = options.message;
  card.append(sticker, message);
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
    // The sticker stays selectable, so a failed copy can still be done by hand.
    if (event.target !== sticker) dismiss();
  });
  return { root: surface.root, dismiss };
}
