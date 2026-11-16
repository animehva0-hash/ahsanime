/**
 * Tiny job queue: max 2 concurrent Gemini jobs per process; the rest queue
 * in arrival order. Multi-user safe by construction.
 */

type Job<T> = {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

const g = globalThis as unknown as {
  __na_queue?: { running: number; waiting: Job<unknown>[] };
};

const state = (g.__na_queue ??= { running: 0, waiting: [] });

const MAX_CONCURRENT = 8;

function pump() {
  while (state.running < MAX_CONCURRENT && state.waiting.length > 0) {
    const job = state.waiting.shift()!;
    state.running++;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        state.running--;
        pump();
      });
  }
}

export function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    state.waiting.push({ run: run as () => Promise<unknown>, resolve, reject } as Job<unknown>);
    pump();
  });
}

export function queueStats() {
  return { running: state.running, waiting: state.waiting.length, max: MAX_CONCURRENT };
}

/* ---- In-flight job dedup (multi-user safe) ---- */

const inflightJobs = new Map<string, Promise<unknown>>();

/**
 * If an identical job is already running/queued, share its result instead of
 * starting a duplicate (e.g. clients retrying while translation is in flight).
 */
export function runDedup<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflightJobs.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    inflightJobs.delete(key);
  });
  inflightJobs.set(key, promise);
  return promise;
}
