// Shared Server-Sent-Events helpers used by the provider adapters (to read
// upstream SSE) and by the routes (to emit a normalized client SSE stream).

import { isLlmCancellation, isLlmTimeout } from './limits';

/**
 * Frame an accumulated SSE buffer into complete `data:` payloads plus the
 * trailing incomplete remainder. Events are separated by a blank line; multiple
 * `data:` lines within one event are joined with newlines. Comment / event-only
 * frames (no `data:` line) are skipped.
 */
export function parseSseData(buffer: string): { data: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const data: string[] = [];
  for (const event of parts) {
    const dataLines = event.split('\n').filter((line) => line.startsWith('data:'));
    if (dataLines.length === 0) continue;
    data.push(dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n'));
  }
  return { data, rest };
}

/**
 * Read an upstream SSE body and yield normalized text deltas, using a
 * provider-specific extractor to turn each parsed event into a text fragment.
 * Stops at an OpenAI-style `[DONE]` sentinel.
 *
 * `onFrame` fires for every upstream event, INCLUDING the ones that extract to
 * nothing — it is the honest "the model is producing output" signal, which the
 * yielded deltas are not: behind a `--reasoning-parser` the whole <think> phase
 * arrives as `reasoning_content` and yields no text at all.
 */
export async function* iterateSseDeltas(
  body: ReadableStream<Uint8Array>,
  extract: (event: unknown) => string | null,
  opts?: { onFrame?: () => void },
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  // Yields deltas for a batch of payloads; sets `done` and stops on [DONE].
  function* process(payloads: string[]): Generator<string> {
    for (const payload of payloads) {
      opts?.onFrame?.();
      if (payload === '[DONE]') {
        done = true;
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // keep-alive / non-JSON line
      }
      const delta = extract(json);
      if (delta) yield delta;
    }
  }

  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const { data, rest } = parseSseData(buffer);
      buffer = rest;
      yield* process(data);
      if (done) return;
    }

    // Stream ended: flush any trailing multi-byte sequence and process a final
    // frame that may have arrived without a terminating blank line.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      yield* process(parseSseData(buffer + '\n\n').data);
    }
  } finally {
    // Also runs when the consumer abandons this generator (the client closed
    // the drawer, so the route's SSE stream was cancelled). Cancelling the body
    // tears the upstream request down instead of leaving the model generating
    // into a socket nobody is reading.
    reader.cancel().catch(() => undefined);
  }
}

// ── Reasoning-block stripping ────────────────────────────────────────────────

// Same alias set as lib/skill-assist.ts's parser: models disagree on the tag
// (<think>, <thinking>, <reasoning>, <thought>), and some emit attributes.
const THINK_OPEN_RE = /<(?:thinking|think|reasoning|thought)(?:\s[^>]*)?>/i;
const THINK_CLOSE_RE = /<\/(?:thinking|think|reasoning|thought)\s*>/i;
const OPEN_TAGS = ['<thinking>', '<think>', '<reasoning>', '<thought>'];
const CLOSE_TAGS = ['</thinking>', '</think>', '</reasoning>', '</thought>'];

/** Longest suffix of `s` that is a proper prefix of `tag` (a tag split across chunks). */
function partialTagTail(s: string, tag: string): string {
  const max = Math.min(tag.length - 1, s.length);
  const lower = s.toLowerCase();
  const tagLower = tag.toLowerCase();
  for (let n = max; n > 0; n--) {
    if (lower.slice(lower.length - n) === tagLower.slice(0, n)) return s.slice(s.length - n);
  }
  return '';
}

/** Hold-back for whichever alias could still be completing at the tail. */
function longestPartialTail(s: string, tags: string[]): string {
  let best = '';
  for (const tag of tags) {
    const t = partialTagTail(s, tag);
    if (t.length > best.length) best = t;
  }
  return best;
}

/**
 * Stateful `<think>…</think>` remover for a streamed answer.
 *
 * Reasoning models (GLM, Qwen-thinking, DeepSeek-R1) emit their chain of thought
 * inline unless the server runs a `--reasoning-parser` that splits it into
 * `reasoning_content`. Without this the thinking is streamed straight into the
 * user's chat bubble. Tags can straddle chunk boundaries, so a possible partial
 * tag is held back and re-joined with the next chunk; `flush()` releases it if
 * the stream ends mid-guess.
 */
export function createThinkStripper(): { push: (chunk: string) => string; flush: () => string } {
  let inThink = false;
  let pending = '';

  return {
    push(chunk: string): string {
      let s = pending + chunk;
      pending = '';
      let out = '';
      for (;;) {
        if (inThink) {
          const close = THINK_CLOSE_RE.exec(s);
          if (!close) {
            pending = longestPartialTail(s, CLOSE_TAGS);
            return out;
          }
          s = s.slice(close.index + close[0].length);
          inThink = false;
          continue;
        }
        const open = THINK_OPEN_RE.exec(s);
        if (!open) {
          const keep = longestPartialTail(s, OPEN_TAGS);
          out += s.slice(0, s.length - keep.length);
          pending = keep;
          return out;
        }
        out += s.slice(0, open.index);
        s = s.slice(open.index + open[0].length);
        inThink = true;
      }
    },
    // Held-back text was only ever a *guess* at a tag; if the stream ended it
    // was real content and must not be swallowed. Anything still inside an
    // unterminated <think> stays dropped.
    flush(): string {
      const rest = inThink ? '' : pending;
      pending = '';
      return rest;
    },
  };
}

/** Wrap a delta stream so inline `<think>` reasoning never reaches the client. */
export async function* stripThinkDeltas(deltas: AsyncIterable<string>): AsyncIterable<string> {
  const stripper = createThinkStripper();
  for await (const delta of deltas) {
    const out = stripper.push(delta);
    if (out) yield out;
  }
  const tail = stripper.flush();
  if (tail) yield tail;
}

// ── Normalized client-facing SSE frames ──────────────────────────────────────
// Clients only ever parse `{ delta }` and `{ error }`, never provider events.

export function encodeSseDelta(delta: string): string {
  return `data: ${JSON.stringify({ delta })}\n\n`;
}

export function encodeSseError(message: string): string {
  return `data: ${JSON.stringify({ error: message })}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';

/**
 * Wrap a delta async-iterable into a normalized SSE ReadableStream for a route.
 * Pass the request's `signal` so a client disconnect ends the stream quietly
 * instead of as an error.
 */
export function toSseResponseStream(
  deltas: AsyncIterable<string>,
  opts?: { signal?: AbortSignal },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every enqueue throws once the consumer has cancelled this stream (the
      // client went away), so nothing below may assume the controller is still
      // open — the error frame and the close included.
      const send = (frame: string): boolean => {
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          return false;
        }
      };
      try {
        for await (const delta of deltas) {
          // Breaking finalizes `deltas`, which is what releases the LLM slot
          // and cancels the upstream request when the reader has gone.
          if (!send(encodeSseDelta(delta))) break;
        }
        send(SSE_DONE);
      } catch (e) {
        // A cancelled generation is not something to report: the reader who
        // aborted it is gone, and an `{error}` frame would only surface as a
        // toast on a client that is still there — which a TIMEOUT is, so that
        // one keeps its message.
        const cancelled = opts?.signal?.aborted || (isLlmCancellation(e) && !isLlmTimeout(e));
        if (!cancelled) send(encodeSseError(e instanceof Error ? e.message : 'stream error'));
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed or cancelled */
        }
      }
    },
  });
}
