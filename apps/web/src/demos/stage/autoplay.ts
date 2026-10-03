import type { SearchResult } from "emojisense";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAutoplayControl } from "../autoplay-control";
import { keystrokeDelay, type Run, wait, waitFor } from "../chat/autoplay";

export { type Run, wait };

const START_DELAY_MS = 700;
/** Longest wait for the target emoji to show in the list. */
const TARGET_WAIT_MS = 2500;

export type AutoState = "waiting" | "playing" | "done" | "off";

interface SkinAutoplayOptions {
  root: RefObject<HTMLElement | null>;
  /** The stage is on screen. */
  visible: boolean;
  /** The engine has loaded. */
  ready: boolean;
  script: (run: Run) => Promise<void>;
  /** Shows the finished demo at once: reduced motion, or "Stop demo". */
  finish: () => void;
  /** Clears a half-played demo for the visitor, who has started to use it. */
  reset: () => void;
}

/**
 * Plays a skin's script once, when the stage is on screen and the engine is ready. Reduced motion
 * and "Stop demo" (WCAG 2.2.2) show the finished state; the visitor's first touch, key or focus in
 * the skin hands it over to them.
 */
export function useSkinAutoplay({
  root,
  visible,
  ready,
  script,
  finish,
  reset,
}: SkinAutoplayOptions): AutoState {
  const [state, setState] = useState<AutoState>("waiting");
  const run = useRef<Run | null>(null);
  const latest = useRef({ state, script, finish, reset });
  useLayoutEffect(() => {
    latest.current = { state, script, finish, reset };
  });

  const end = useCallback((then: "finish" | "reset") => {
    const current = latest.current.state;
    if (current === "off" || current === "done") return;
    if (run.current) run.current.cancelled = true;
    if (then === "finish") latest.current.finish();
    else if (current === "playing") latest.current.reset();
    setState("off");
  }, []);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) end("finish");
  }, [end]);

  useAutoplayControl(
    state === "playing",
    useCallback(() => end("finish"), [end]),
  );

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const handOver = () => end("reset");
    const events = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of events) element.addEventListener(type, handOver, { capture: true });
    return () => {
      for (const type of events) element.removeEventListener(type, handOver, { capture: true });
    };
  }, [root, end]);

  useEffect(() => {
    if (state !== "waiting" || !visible || !ready || run.current) return;
    const current: Run = { cancelled: false };
    run.current = current;
    setState("playing");
    wait(START_DELAY_MS)
      .then(() => (current.cancelled ? undefined : latest.current.script(current)))
      .then(() => {
        if (!current.cancelled) setState("done");
      });
  }, [state, visible, ready]);

  useEffect(
    () => () => {
      if (run.current) run.current.cancelled = true;
    },
    [],
  );

  return state;
}

/** Types `text` after `from` like a person; false when the run was cancelled. */
export async function typeText(run: Run, from: string, text: string, write: (value: string) => void) {
  let value = from;
  for (const char of text) {
    await wait(keystrokeDelay(value.at(-1) ?? "", char));
    if (run.cancelled) return false;
    value += char;
    write(value);
  }
  return true;
}

export interface PickDriver {
  results: SearchResult[];
  setActive: (index: number) => void;
  pick: (result: SearchResult) => void;
  press: (pressing: boolean) => void;
}

/**
 * Waits for `target` in the list, moves the highlight down to it row by row, presses and picks it.
 * Meaning search can still reorder the list, so the row is found again before each step.
 */
export async function highlightAndPick(run: Run, target: string, driver: () => PickDriver): Promise<void> {
  const indexOf = () => driver().results.findIndex((r) => r.id === target);
  const found = await waitFor(indexOf, (index) => index >= 0, TARGET_WAIT_MS);
  // Time to read the list before the highlight moves.
  await wait(1000);
  for (let row = 1; row <= Math.max(found, 0); row++) {
    if (run.cancelled) return;
    driver().setActive(row);
    await wait(220);
  }
  if (run.cancelled) return;
  driver().press(true);
  await wait(170);
  driver().press(false);
  const { results } = driver();
  const result = results.find((r) => r.id === target) ?? results[0];
  if (result && !run.cancelled) driver().pick(result);
}
