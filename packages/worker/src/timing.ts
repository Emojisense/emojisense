/**
 * Stage durations of one request for the `Server-Timing` header (docs/API.md). Stages that run
 * at the same time each report their own duration, so they can add up to more than `total`.
 * `total` runs from the moment the request reached the Worker's router (app.ts), key check
 * included. Inside Workers the clock moves only on I/O: a stage of pure computation reports 0.
 */
export class ServerTiming {
  readonly #now: () => number;
  readonly #started: number;
  readonly #stages: [name: string, ms: number][] = [];

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#started = now();
  }

  /** Waits for `work` and records how long it took from this call. */
  async measure<T>(name: string, work: Promise<T>): Promise<T> {
    const started = this.#now();
    try {
      return await work;
    } finally {
      this.add(name, this.#now() - started);
    }
  }

  add(name: string, ms: number): void {
    this.#stages.push([name, Math.max(0, Math.round(ms))]);
  }

  /** `name;dur=ms, …, total;dur=ms`, stages in the order they finished. */
  header(): string {
    const total = this.#now() - this.#started;
    return [...this.#stages, ["total", Math.max(0, Math.round(total))] as const]
      .map(([name, ms]) => `${name};dur=${ms}`)
      .join(", ");
  }
}
