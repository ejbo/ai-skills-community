'use client';

// Reads a normalized SSE stream (`data: {"delta":"..."}` / `{"error":"..."}` /
// `[DONE]`) from one of our chat endpoints and invokes onDelta for each text
// fragment. Shared by the Try It chat and the comparison workshop.

export interface StreamChatResult {
  ok: boolean;
  error?: string;
}

export async function streamChat(
  url: string,
  payload: unknown,
  onDelta: (delta: string) => void,
): Promise<StreamChatResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.reason ?? data.error ?? '请求失败' };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let streamError: string | undefined;
  let doneSeen = false;

  // Returns true if this chunk contained the [DONE] sentinel.
  function handle(chunk: string): boolean {
    for (const line of chunk.split('\n')) {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m) continue;
      const payloadStr = m[1];
      if (payloadStr === '[DONE]') return true;
      try {
        const obj = JSON.parse(payloadStr);
        if (typeof obj.delta === 'string') onDelta(obj.delta);
        else if (typeof obj.error === 'string') streamError = obj.error;
      } catch {
        /* ignore keep-alive / non-JSON lines */
      }
    }
    return false;
  }

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() ?? '';
    for (const chunk of chunks) {
      if (handle(chunk)) {
        doneSeen = true;
        break;
      }
    }
    if (doneSeen) break;
  }

  // Flush trailing bytes and process a final frame that lacked a "\n\n".
  if (!doneSeen) {
    buf += decoder.decode();
    if (buf.length > 0 && handle(buf)) doneSeen = true;
  }

  // A stream that ends without [DONE] and without an explicit error frame was
  // interrupted (network drop / server crash) — surface it rather than masking
  // it as success.
  if (streamError) return { ok: false, error: streamError };
  if (!doneSeen) return { ok: false, error: '连接中断，请重试' };
  return { ok: true };
}
