/** Human-ish typing rhythm: uneven keystrokes, a beat after spaces, the odd pause to think. */
export function keystrokeDelay(previous: string, next: string): number {
  let ms = 42 + Math.random() * 68;
  if (next === " ") ms += 30 + Math.random() * 60;
  if (previous === " " && Math.random() < 0.2) ms += 160 + Math.random() * 240;
  if (next === ":") ms += 140;
  if (previous === next) ms -= 18;
  return ms;
}

export interface Run {
  cancelled: boolean;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `read` until `done` accepts its value or the time runs out; returns the last value. */
export async function waitFor<T>(read: () => T, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const until = performance.now() + timeoutMs;
  let value = read();
  while (!done(value) && performance.now() < until) {
    await wait(50);
    value = read();
  }
  return value;
}
