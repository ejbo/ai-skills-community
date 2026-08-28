// Shared in-process FIFO for the CPU/disk-heavy child processes that upload
// handlers run inline — today the ffmpeg faststart remux in lib/video/storage,
// lib/votes/storage, lib/zones/storage and lib/uploads/post-media-storage.
//
// WHY it exists: each remux is a full-file, disk-to-disk stream copy, and it was
// awaited straight from the request handler with no bound. N simultaneous
// uploaders therefore meant N whole-file copies on the SAME disk that serves
// every video byte and every PostgreSQL WAL flush — that disk queue, not the
// CPU, is what made playback stutter while anyone uploaded. Serialising the
// jobs costs an uploader some wait (the upload still succeeds, just later) and
// costs every reader nothing.
//
// WHY the wait is BOUNDED (`tryRunMediaJob`): serialising moved the cost from
// the disk onto the clock, and the clock has a hard ceiling — nginx's
// `proxy_read_timeout 300s`. Queued behind two worst-case jobs, a third upload
// handler would still be awaiting a slot when nginx gave up and returned 504,
// with the uploaded file already fully written to disk and (for votes/shorts)
// no DB row yet to own it. The uploader sees a failure, re-uploads, and the
// first write is orphaned on the volume this box shares with PostgreSQL.
// Nothing GCs those. So callers on a request path declare how long they can
// afford to wait, and past it the job is SKIPPED rather than run late — safe
// precisely because these jobs are best-effort (see MEDIA_JOB_MAX_WAIT_MS).
//
// Deliberately dependency-free, and deliberately NOT importing `@/lib/env`:
// three of the four storage modules that call this read `process.env` directly
// on purpose so their pure helpers stay unit-testable without a validated
// environment (see their header notes), and this queue must not be what drags
// the whole env schema into their import graph. The parse below mirrors
// lib/env.ts's `num(1, 1)` for MEDIA_JOB_CONCURRENCY exactly.

/**
 * How long a caller on a request path will wait for a slot before abandoning
 * the job entirely.
 *
 * The arithmetic, per upload request, against nginx's `proxy_read_timeout 300s`
 * (deploy/ai-community.nginx.conf PART B §2 — the app sits behind that ONE
 * proxy location, so 300 s is the entire budget a handler has to answer in):
 *
 *     300 s   nginx proxy_read_timeout — the hard ceiling. Past it the client
 *             gets a 504 even though the body is already fully on disk.
 *   − 180 s   FFMPEG_TIMEOUT_MS — our own remux, once it starts, is bounded but
 *             may use all of it (all four storage modules use that same figure).
 *   −  30 s   FFPROBE_TIMEOUT_MS — several handlers probe duration right after
 *             the remux (e.g. app/api/votes/[id]/submissions/route.ts).
 *   ───────
 *      90 s   left for the queue wait + the DB writes + the response.
 *
 * 45 s is half of that remainder. Worst case becomes 45 + 180 + 30 = 255 s,
 * leaving ~45 s of margin for the DB round-trips and for the fact that this
 * location runs `proxy_request_buffering off`, so nginx has already been
 * holding the upstream connection open for however long the client took to
 * push the body up.
 *
 * Skipping is the RIGHT answer past that point, not a degradation we tolerate:
 * the remux is best-effort by contract — a box without ffmpeg, or a file over
 * FASTSTART_MAX_BYTES, is already a documented no-op that returns false and
 * lets the upload succeed with a tail-`moov` file (slower first frame, plays
 * fine). Skipping costs one uploader that; waiting costs them the whole upload.
 */
export const MEDIA_JOB_MAX_WAIT_MS = 45_000;

type Waiter = { start: () => void };

const waiting: Waiter[] = [];
let running = 0;
let skipped = 0;

/**
 * Concurrency limit, read per pump rather than cached at import so a test (or a
 * restart-free env edit) sees the current value. Blank/garbage ⇒ 1, never NaN —
 * a typo must not silently remove the guard.
 */
function limit(): number {
  const n = Number.parseInt((process.env.MEDIA_JOB_CONCURRENCY ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function pump(): void {
  while (running < limit()) {
    const next = waiting.shift();
    if (!next) return;
    running += 1;
    next.start();
  }
}

/**
 * `setTimeout` here may be typed as Node's (returns a `Timeout` with `unref`)
 * or as the DOM's (returns a number) — tsconfig pulls in BOTH lib.dom and
 * @types/node. Probe for the method instead of asserting either: an abandoned
 * job's timer must never be what keeps the process alive.
 */
function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  (t as unknown as { unref?: () => void }).unref?.();
}

/**
 * `ran: true` — the job started and `value` is exactly what `fn` resolved to.
 * `ran: false` — no slot came free inside the deadline, so `fn` was NEVER
 * called. The two are deliberately different shapes: a skip is not a failure
 * and must not be logged or cleaned up as one (nothing ran, so nothing was
 * written), while a job that ran and returned a falsy value is the caller's own
 * failure to handle.
 */
export type MediaJobOutcome<T> = { ran: true; value: T } | { ran: false; reason: 'busy' };

/**
 * Core enqueue. `waitMs === null` waits forever (the historical behaviour that
 * `runMediaJob` still promises); a finite value abandons the waiter once it
 * elapses. Anything not a positive finite number ⇒ 0 ⇒ "run only if a slot is
 * free right now", i.e. a bad value fails toward skipping, never toward
 * waiting past the deadline.
 */
function enqueue<T>(fn: () => Promise<T>, waitMs: number | null): Promise<MediaJobOutcome<T>> {
  return new Promise<MediaJobOutcome<T>>((resolve, reject) => {
    const deadlineMs =
      waitMs === null ? null : Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let claimed = false; // started OR abandoned — whichever got there first

    const waiter: Waiter = {
      start: () => {
        claimed = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        let settled: Promise<T>;
        try {
          settled = Promise.resolve(fn());
        } catch (e) {
          settled = Promise.reject(e);
        }
        // Bookkeeping FIRST, then hand the outcome to the caller: the slot is
        // free before the uploader's `await` resumes, so `mediaJobQueueSize()`
        // is never stale for a tick. The intermediate rejection is consumed by
        // the `.then(…, reject)` below — nothing here is ever unhandled.
        settled
          .finally(() => {
            running -= 1;
            // Yield so a burst of jobs cannot starve the event loop (same
            // reason lib/zones/office-preview.ts's pump does).
            setImmediate(pump);
          })
          .then((value) => resolve({ ran: true, value }), reject);
      },
    };

    const abandon = () => {
      if (claimed) return; // unreachable: start() clears the timer first
      claimed = true;
      const i = waiting.indexOf(waiter);
      if (i >= 0) waiting.splice(i, 1); // never leave a waiter in the array
      skipped += 1;
      // A skip only happens after a full deadline of queueing, so this is a
      // rare, load-bearing line rather than noise: it is the ONLY signal that
      // MEDIA_JOB_CONCURRENCY is now the bottleneck.
      console.warn(
        `[media-job] skipped after waiting ${deadlineMs}ms for a slot (queue ${mediaJobQueueSize()}, total skipped ${skipped})`,
      );
      resolve({ ran: false, reason: 'busy' });
    };

    waiting.push(waiter);
    pump(); // may claim this waiter synchronously when a slot is already free

    if (claimed || deadlineMs === null) return; // running, or waiting without a deadline
    if (deadlineMs === 0) {
      abandon();
      return;
    }
    timer = setTimeout(abandon, deadlineMs);
    unrefTimer(timer);
  });
}

/**
 * Run `fn` once a slot is free, FIFO, waiting as long as it takes. The returned
 * promise settles exactly like `fn`'s — callers keep their own success/failure
 * semantics; the queue only decides WHEN the work starts.
 *
 * A rejecting (or synchronously throwing) job must never wedge the queue: the
 * slot is released in a `finally` and the next waiter is always pumped, which on
 * a concurrency-1 queue is the difference between one bad file and every later
 * upload hanging.
 *
 * Use this only OFF the request path. Anything a client is waiting on wants
 * `tryRunMediaJob` — an unbounded wait behind nginx is a 504 with the bytes
 * already on disk.
 */
export async function runMediaJob<T>(fn: () => Promise<T>): Promise<T> {
  const outcome = await enqueue(fn, null);
  if (!outcome.ran) {
    // Unreachable: only a finite deadline abandons a waiter. Kept as a real
    // narrowing guard rather than a cast, so a future edit to `enqueue` cannot
    // silently turn a skipped job into `undefined` at this call site.
    throw new Error('media job abandoned without a deadline');
  }
  return outcome.value;
}

/**
 * Run `fn` once a slot is free, but give up waiting after `waitMs` and report
 * that the job never started. `fn` is called at most once and never after the
 * deadline; a job that has already started is NEVER interrupted (it keeps its
 * own internal timeout).
 *
 * Callers must branch on `ran` before reading `value`; see MediaJobOutcome.
 */
export function tryRunMediaJob<T>(
  fn: () => Promise<T>,
  waitMs: number = MEDIA_JOB_MAX_WAIT_MS,
): Promise<MediaJobOutcome<T>> {
  return enqueue(fn, waitMs);
}

/** Jobs waiting plus jobs in flight (for diagnostics / tests). */
export function mediaJobQueueSize(): number {
  return waiting.length + running;
}

/**
 * How many jobs have been skipped because no slot came free in time, for the
 * life of the process (diagnostics / tests). Non-zero means uploads are giving
 * up their faststart remux — raise MEDIA_JOB_CONCURRENCY, or accept it.
 */
export function mediaJobSkipCount(): number {
  return skipped;
}
