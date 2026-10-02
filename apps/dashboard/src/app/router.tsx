/**
 * A minimal history router: a dozen flat routes do not need a routing library (routes.ts maps
 * paths to pages). The Worker's `not_found_handling: "single-page-application"` serves
 * index.html for every deep link.
 */
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

const NAVIGATE_EVENT = "emojisense:navigate";
let navigated = false;

function subscribe(onChange: () => void): () => void {
  const onPopState = () => {
    navigated = true;
    onChange();
  };
  window.addEventListener("popstate", onPopState);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The query string as URLSearchParams; re-renders when it changes. */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  navigated = true;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // Let the browser handle new-tab and download gestures.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }
  return <a {...rest} href={to} onClick={handleClick} />;
}

/**
 * Sets the document title and, after a client-side navigation, moves focus to the page heading
 * so screen readers announce the new page. The first load keeps the browser's default focus.
 */
export function usePageHeading(title: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Emojisense dashboard`;
    if (navigated) ref.current?.focus();
  }, [title]);
  return ref;
}
