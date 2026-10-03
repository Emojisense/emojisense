/**
 * Calls `onMatch` once for each element that matches `selector`: those on the page now, and those
 * added later (BuddyPress and bbPress themes render forms and activity items with JavaScript).
 * Returns a function that stops watching.
 */
export function observeMatches<T extends HTMLElement = HTMLElement>(
  doc: Document,
  selector: string,
  onMatch: (element: T) => void,
): () => void {
  const seen = new WeakSet<Element>();
  const visit = (root: ParentNode) => {
    const candidates = root instanceof Element && root.matches(selector) ? [root] : [];
    for (const element of [...candidates, ...root.querySelectorAll(selector)]) {
      if (seen.has(element)) continue;
      seen.add(element);
      onMatch(element as T);
    }
  };
  visit(doc);
  const view = doc.defaultView;
  if (!view || !("MutationObserver" in view)) return () => {};
  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) visit(node as Element);
      }
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
