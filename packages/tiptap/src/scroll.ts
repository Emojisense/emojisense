/**
 * Kept byte-identical in @emojisense/tiptap and @emojisense/lexical, like source.ts.
 *
 * `option.scrollIntoView({ block: "nearest" })`, but only `menu` scrolls. The native call also
 * scrolls every scrollable ancestor and the page, which moves the host page whenever the menu
 * is partly outside the viewport.
 */
export function scrollOptionIntoView(menu: HTMLElement, option: HTMLElement): void {
  const box = menu.getBoundingClientRect();
  // Rects include CSS transforms (a scaled host frame) and scrollTop does not.
  const scale = box.height > 0 && menu.offsetHeight > 0 ? box.height / menu.offsetHeight : 1;
  const top = box.top + menu.clientTop * scale;
  const bottom = top + menu.clientHeight * scale;
  const target = option.getBoundingClientRect();
  if (target.top < top) {
    menu.scrollTop -= (top - target.top) / scale;
  } else if (target.bottom > bottom) {
    menu.scrollTop += (target.bottom - bottom) / scale;
  }
}
