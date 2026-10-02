import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHealth, type Health } from "./lib/edge";

/** `navigator.onLine`, kept current. True during the server render. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export type HealthState = { kind: "checking" } | { kind: "up"; health: Health } | { kind: "down" };

/** `GET /v1/health`, asked again when the browser comes back online. */
export function useHealth(online: boolean): HealthState {
  const [state, setState] = useState<HealthState>({ kind: "checking" });
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    fetchHealth(controller.signal).then((health) => {
      if (!controller.signal.aborted) setState(health ? { kind: "up", health } : { kind: "down" });
    });
    return () => controller.abort();
  }, [online]);
  return state;
}

/** Copies text and remembers which item was copied for a moment, for a "Copied" label. */
export function useCopy(): {
  copied: string | undefined;
  copy: (text: string, id?: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState<string | undefined>();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string, id = text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setCopied(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(undefined), 1400);
    return true;
  }, []);
  return { copied, copy };
}
