import { useCallback, useEffect, useRef, useState } from "react";
import { fullEngine } from "../../lib/engine-client";
import { browserApi } from "./browser-api";
import { runTool, type ToolRun } from "./mcp";
import type { ReplyBlock, Scenario } from "./scenarios";

/** sent → calling (the tool card spins) → answered (results in) → streaming → done. */
export type TurnPhase = "sent" | "calling" | "answered" | "streaming" | "done" | "failed";

export interface Turn {
  key: number;
  scenario: Scenario;
  /** The server was set up with an API key: unsure queries also go to meaning search. */
  semantic: boolean;
  phase: TurnPhase;
  run?: ToolRun;
  reply?: ReplyBlock[];
  /** Words of the reply on screen. */
  shown: number;
  /** The tool card is expanded. */
  open: boolean;
  /** The visitor toggled the card, so it no longer folds by itself. */
  touched: boolean;
}

const MS = {
  /** From the user message to the tool call. */
  think: 450,
  /** Shortest time the card shows "Running", so the call reads as a step. */
  call: 650,
  /** Time to look at the results before the card folds and the answer starts. */
  read: 1400,
  word: 34,
} as const;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function countWords(blocks: readonly ReplyBlock[]): number {
  return blocks.reduce((sum, block) => sum + splitWords(block.text).length, 0);
}

/** Resolves after `ms`, or at once when `signal` aborts (the turn is skipped ahead). */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The conversation. Each prompt plays as one turn. A new prompt skips the turn in progress to its
 * final state, so a click never waits. Under reduced motion every turn lands in its final state.
 */
export function useConversation() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const live = useRef(new Set<AbortController>());
  const seq = useRef(0);

  useEffect(
    () => () => {
      for (const controller of live.current) controller.abort();
    },
    [],
  );

  const patch = useCallback((key: number, change: (turn: Turn) => Partial<Turn>) => {
    setTurns((prev) => prev.map((turn) => (turn.key === key ? { ...turn, ...change(turn) } : turn)));
  }, []);

  const play = useCallback(
    async (key: number, scenario: Scenario, semantic: boolean, signal: AbortSignal) => {
      const instant = prefersReducedMotion();
      const wait = (ms: number) => pause(instant ? 0 : ms, signal);
      await wait(MS.think);
      patch(key, () => ({ phase: "calling" }));
      const started = performance.now();
      let run: ToolRun;
      try {
        run = await runTool(await fullEngine(), scenario.call, semantic ? browserApi() : undefined);
      } catch {
        patch(key, () => ({ phase: "failed", open: true }));
        return;
      }
      await wait(MS.call - (performance.now() - started));
      patch(key, () => ({ phase: "answered", run }));
      await wait(MS.read);

      const reply = scenario.reply(run);
      const total = countWords(reply);
      const stream = !instant && !signal.aborted;
      patch(key, (turn) => ({
        phase: stream ? "streaming" : "done",
        reply,
        shown: stream ? 0 : total,
        open: turn.touched ? turn.open : false,
      }));
      if (!stream) return;
      for (let shown = 1; shown <= total && !signal.aborted; shown++) {
        await wait(MS.word);
        patch(key, () => ({ shown }));
      }
      patch(key, () => ({ phase: "done", shown: total }));
    },
    [patch],
  );

  const send = useCallback(
    (scenario: Scenario, semantic: boolean) => {
      for (const controller of live.current) controller.abort();
      const key = ++seq.current;
      const controller = new AbortController();
      live.current.add(controller);
      setTurns((prev) => [
        ...prev.map((turn) => (turn.open ? { ...turn, open: false } : turn)),
        { key, scenario, semantic, phase: "sent", shown: 0, open: true, touched: false },
      ]);
      void play(key, scenario, semantic, controller.signal).finally(() => live.current.delete(controller));
    },
    [play],
  );

  const toggle = useCallback(
    (key: number) => patch(key, (turn) => ({ open: !turn.open, touched: true })),
    [patch],
  );

  /** Skips every turn in progress to its final state. */
  const finish = useCallback(() => {
    for (const controller of live.current) controller.abort();
  }, []);

  return { turns, send, toggle, finish };
}
