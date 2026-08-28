// Bounds for the LLM path: an in-process concurrency ceiling and the two
// deadlines every call needs. Import-free (no env, no prisma) so the providers
// stay testable, and process-local by design — one Node process IS the whole
// deployment, so a module-level counter is the global ceiling.
//
// The three numbers are read from `process.env` DIRECTLY rather than through
// lib/env.ts — importing the validated env here would drag the whole schema
// into the providers' import graph and cost them their env-free unit tests, the
// same reason lib/uploads/job-queue.ts parses MEDIA_JOB_CONCURRENCY by hand.
// The parse below mirrors lib/env.ts's `num(def, min)` exactly, and each value
// is read PER USE rather than cached at import, so a value is never baked in:
// CLAUDE.md's contract is that env changes need a restart, never a rebuild.
// They were constants for one release and that was the bug — an operator
// watching a shared intranet vLLM chew through a tens-of-thousands-of-CJK-
// character 知识库 prompt, with `LLM_MAX_CONCURRENT` generations now competing
// for prefill, had no way to raise a deadline without a code change.

/**
 * Positive-integer knob with a default, same contract as lib/env.ts's `num`:
 * blank / garbage / below `min` ⇒ `def`, never NaN. Nothing here can be set to
 * a value that DISABLES the guard it configures — a 0 concurrency wedges the
 * queue permanently (no waiter is ever admitted) and a 0 deadline aborts every
 * call, so both are read as the typo they are and fall back to the shipped
 * value. To all but remove a deadline, set an absurdly large one explicitly.
 */
function envInt(name: string, def: number, min: number): number {
  const n = Number.parseInt((process.env[name] ?? '').trim(), 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

/** Floor for both deadlines: a sub-second LLM budget is only ever seconds typed as ms. */
const MIN_TIMEOUT_MS = 1_000;

/**
 * Concurrent upstream generations (`LLM_MAX_CONCURRENT`, default 6). The shared
 * intranet vLLM is ONE box: twenty readers asking at the same time meant forty
 * unqueued requests (a 知识库 question is two serialized calls — retrieval plan,
 * then the answer), which the model answers by slowing every one of them down
 * while we hold forty sockets and forty response buffers open on the single JS
 * thread. Queuing costs the same wall-clock time and bounds the memory.
 *
 * The default is a property of the model box, not of the deploy, so this is not
 * a knob to reach for casually — but the BOX is exactly what changes (a second
 * worker, a bigger GPU, or a day when the model is also serving the news app),
 * and following that must not require a rebuild.
 */
export function llmMaxConcurrent(): number {
  return envInt('LLM_MAX_CONCURRENT', 6, 1);
}

/**
 * Whole-request budget for a non-streaming call (`LLM_COMPLETE_TIMEOUT_MS`,
 * default 300 000). The default matches nginx's `proxy_read_timeout 300s`, so
 * nothing a user could actually have received is being cut — but undici's own
 * limits are per-phase (300 s for headers, then 300 s BETWEEN body chunks),
 * which is not a bound on anything. Raise nginx's timeout alongside this one:
 * whichever is smaller is the real deadline.
 */
export function llmCompleteTimeoutMs(): number {
  return envInt('LLM_COMPLETE_TIMEOUT_MS', 300_000, MIN_TIMEOUT_MS);
}

/**
 * Time to first BYTE for a streaming call (`LLM_STREAM_TTFB_TIMEOUT_MS`,
 * default 120 000) — never a total duration. A long answer is legitimate and
 * must not be cut off mid-sentence; an upstream that has said nothing at all
 * for two minutes is hung.
 *
 * Two minutes is a guess about ONE deployment, which is why it is a knob: a
 * queued generation waits for its slot before this clock starts, but prefill of
 * a very long prompt on a contended box happens after it, and a real
 * time-to-first-token past the default is a plausible thing to have to absorb.
 */
export function llmStreamTtfbTimeoutMs(): number {
  return envInt('LLM_STREAM_TTFB_TIMEOUT_MS', 120_000, MIN_TIMEOUT_MS);
}

/** A deadline fired. Distinguishable from a caller abort, which is not an error. */
export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

function causeOf(e: unknown): unknown {
  return (e as { cause?: unknown } | null | undefined)?.cause;
}

function isAbortShaped(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * True when a call ended because someone cancelled it — the caller's signal
 * (the reader closed the drawer) or one of our deadlines. Node's fetch rejects
 * with the abort *reason*, but a dispatcher can also surface it wrapped in a
 * `TypeError: fetch failed` carrying it as `cause`, so both are checked.
 */
export function isLlmCancellation(e: unknown): boolean {
  const cause = causeOf(e);
  return (
    isAbortShaped(e) ||
    e instanceof LLMTimeoutError ||
    isAbortShaped(cause) ||
    cause instanceof LLMTimeoutError
  );
}

/** The timeout half of the above: a cancellation the USER still needs told about. */
export function isLlmTimeout(e: unknown): boolean {
  return e instanceof LLMTimeoutError || causeOf(e) instanceof LLMTimeoutError;
}

/**
 * The cancellation this module raises. Deliberately NOT the parent signal's own
 * reason: Next aborts `req.signal` with a `ResponseAborted` error whose name is
 * NOT `AbortError`, and everything downstream — egress's error rewrite, the SSE
 * error frame — classifies by name. Forwarding it would log a client disconnect
 * as a model outage.
 */
function abortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

// ── Deadlines ────────────────────────────────────────────────────────────────

export interface LLMDeadline {
  /** Pass to fetch: fires on the caller's abort OR on the deadline. */
  readonly signal: AbortSignal;
  /**
   * Stop the clock — the upstream is alive. The caller's signal stays wired, so
   * a client disconnect still cancels the request afterwards.
   */
  reached(): void;
  /**
   * The upstream is alive but has not produced anything yet — an SSE keepalive
   * (`: ping`), which carries no `data:` payload and so is not a frame
   * `reached()` will ever see. RESTARTS the clock instead of stopping it: a
   * proxy that pings on a fixed interval must not be able to switch the
   * deadline off, or a generation that is hung behind a chatty proxy would hold
   * its slot forever. No-op once the clock has been stopped or disposed.
   */
  keepAlive(): void;
  /** Drop the timer and the parent listener. Always call in a `finally`. */
  dispose(): void;
}

/**
 * `parent` plus a deadline, as one signal. `AbortSignal.timeout()` cannot be
 * cancelled and `AbortSignal.any()` cannot be un-wired, and a streaming call
 * must be able to stop its clock at the first byte — hence the manual pair.
 */
function llmDeadline(parent: AbortSignal | undefined, ms: number, message: string): LLMDeadline {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // False once the clock is stopped for good (first byte, deadline fired, or
  // disposed), so a late keepAlive can never re-arm a finished request.
  let running = true;
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      running = false;
      ac.abort(new LLMTimeoutError(message));
    }, ms);
  };
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  arm();
  const onParent = () => ac.abort(abortError());
  if (parent) {
    if (parent.aborted) ac.abort(abortError());
    else parent.addEventListener('abort', onParent, { once: true });
  }
  return {
    signal: ac.signal,
    reached() {
      running = false;
      clearTimer();
    },
    keepAlive() {
      if (!running) return;
      clearTimer();
      arm();
    },
    dispose() {
      running = false;
      clearTimer();
      parent?.removeEventListener('abort', onParent);
    },
  };
}

export function completeDeadline(parent?: AbortSignal): LLMDeadline {
  const ms = llmCompleteTimeoutMs();
  // Rounded because the message is user-facing and the knob is in ms.
  return llmDeadline(parent, ms, `模型在 ${Math.round(ms / 1000)} 秒内没有返回结果，请求已取消`);
}

export function streamDeadline(parent?: AbortSignal): LLMDeadline {
  const ms = llmStreamTtfbTimeoutMs();
  return llmDeadline(parent, ms, `模型在 ${Math.round(ms / 1000)} 秒内没有开始返回内容，请求已取消`);
}

// ── FIFO concurrency gate ────────────────────────────────────────────────────
// Same shape as lib/zones/office-preview's conversion queue (which bounds
// LibreOffice the same way). Kept separate on purpose: this one hands out slots
// held across a whole streamed answer, not one-shot jobs.

interface Waiter {
  resolve: (release: () => void) => void;
  detach: () => void;
}

const waiting: Waiter[] = [];
let active = 0;

function makeRelease(): () => void {
  let released = false;
  return () => {
    // A stream can end normally AND then be finalized by an abort; releasing
    // twice would hand out a slot that was never taken.
    if (released) return;
    released = true;
    active--;
    pump();
  };
}

function pump(): void {
  // Once per drain, not per iteration: the parse is cheap but not free, and the
  // ceiling cannot change mid-loop anyway (nothing here awaits).
  const max = llmMaxConcurrent();
  while (active < max) {
    const next = waiting.shift();
    if (!next) return;
    next.detach();
    active++;
    next.resolve(makeRelease());
  }
}

/**
 * Take one of the `LLM_MAX_CONCURRENT` slots, FIFO. Resolves to the release
 * function — call it once, in a `finally` that also runs when a generator is
 * abandoned mid-stream.
 *
 * A caller whose signal aborts while still QUEUED is dropped from the queue and
 * rejected: there is no point starting a generation for a reader who has
 * already left, and it would hold the slot the people behind them are waiting
 * for.
 */
export function acquireLlmSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active < llmMaxConcurrent()) {
    active++;
    return Promise.resolve(makeRelease());
  }
  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = { resolve, detach: () => undefined };
    if (signal) {
      const onAbort = () => {
        const i = waiting.indexOf(waiter);
        if (i >= 0) waiting.splice(i, 1);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waiter.detach = () => signal.removeEventListener('abort', onAbort);
    }
    waiting.push(waiter);
  });
}

/** In-flight and queued generations (diagnostics / tests). */
export function llmQueueDepth(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}
