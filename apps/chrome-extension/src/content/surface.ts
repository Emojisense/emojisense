/**
 * A shadow-DOM surface on the page for the picker and the toast.
 *
 * - Closed shadow root: page scripts cannot read the search box through `host.shadowRoot`.
 * - Constructed stylesheet: CSSOM is not subject to the page's `style-src` CSP, a `<style>` element
 *   can be. The `<style>` fallback is only for engines without constructable stylesheets.
 * - Inline `!important` host styles: page rules such as `* { … }` beat `:host` rules, but not these.
 * - Top layer via the Popover API: stays above any z-index and escapes `overflow` and transforms.
 */
export interface Surface {
  host: HTMLElement;
  root: ShadowRoot;
  moveTo(top: number, left: number): void;
  remove(): void;
}

const HOST_STYLES: ReadonlyArray<[string, string]> = [
  ["all", "initial"],
  ["display", "block"],
  ["position", "fixed"],
  ["inset", "auto"],
  ["margin", "0"],
  ["padding", "0"],
  ["border", "0"],
  ["background", "transparent"],
  ["overflow", "visible"],
  ["z-index", "2147483647"],
  // `medium` is the user's default font size; rem would follow the page's root size instead.
  ["font-size", "medium"],
];

export function createSurface(doc: Document, mount: Element, css: string): Surface {
  const host = doc.createElement("emojisense-ui");
  for (const [property, value] of HOST_STYLES) host.style.setProperty(property, value, "important");
  const root = host.attachShadow({ mode: "closed" });
  adoptStyles(doc, root, css);
  mount.append(host);
  showInTopLayer(host);

  return {
    host,
    root,
    moveTo(top, left) {
      host.style.setProperty("top", `${Math.round(top)}px`, "important");
      host.style.setProperty("left", `${Math.round(left)}px`, "important");
    },
    remove() {
      host.remove();
    },
  };
}

function adoptStyles(doc: Document, root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // Fall through to a <style> element.
  }
  const style = doc.createElement("style");
  style.textContent = css;
  root.prepend(style);
}

function showInTopLayer(host: HTMLElement): void {
  if (typeof host.showPopover !== "function") return;
  host.popover = "manual";
  try {
    host.showPopover();
  } catch {
    // Not shown (e.g. the mount is inert): the fixed position and z-index still apply.
  }
}
