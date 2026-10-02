import type { PlanId } from "@emojisense/platform";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, isPlanRequired } from "../api";

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "plan"; plan: PlanId }
  | { status: "error"; message: string; httpStatus: number };

export interface ResourceControls<T> {
  reload: () => void;
  /** Local update after a write, so the page does not refetch. */
  mutate: (change: (data: T) => T) => void;
}

/**
 * Loads data for a page. A `402 plan_required` becomes `{ status: "plan" }`, so pages render an
 * upsell instead of an error. `key` identifies the request: a new key loads again.
 */
export function useResource<T>(key: string, load: () => Promise<T>): [Resource<T>, ResourceControls<T>] {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const loadedKey = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `attempt` are the triggers
  useEffect(() => {
    let current = true;
    // A reload keeps the current data on screen; a new key starts from a loading state.
    const sameKey = loadedKey.current === key;
    loadedKey.current = key;
    setState((previous) => (sameKey && previous.status === "ready" ? previous : { status: "loading" }));
    loadRef.current().then(
      (data) => current && setState({ status: "ready", data }),
      (error: unknown) => {
        if (!current) return;
        setState(
          isPlanRequired(error)
            ? { status: "plan", plan: error.plan }
            : {
                status: "error",
                message: errorMessage(error),
                httpStatus: error instanceof ApiError ? error.status : 0,
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const mutate = useCallback(
    (change: (data: T) => T) =>
      setState((previous) =>
        previous.status === "ready" ? { status: "ready", data: change(previous.data) } : previous,
      ),
    [],
  );
  return [state, { reload, mutate }];
}
