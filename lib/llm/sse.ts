// Shared Server-Sent-Events helpers used by the provider adapters (to read
// upstream SSE) and by the routes (to emit a normalized client SSE stream).

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
 */
export async function* iterateSseDeltas(
  body: ReadableStream<Uint8Array>,
  extract: (event: unknown) => string | null,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  // Yields deltas for a batch of payloads; sets `done` and stops on [DONE].
  function* process(payloads: string[]): Generator<string> {
    for (const payload of payloads) {
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

/** Wrap a delta async-iterable into a normalized SSE ReadableStream for a route. */
export function toSseResponseStream(deltas: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of deltas) {
          controller.enqueue(encoder.encode(encodeSseDelta(delta)));
        }
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (e) {
        const message = e instanceof Error ? e.message : 'stream error';
        controller.enqueue(encoder.encode(encodeSseError(message)));
      } finally {
        controller.close();
      }
    },
  });
}
