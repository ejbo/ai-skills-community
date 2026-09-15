// Read a JSON request body with a HARD byte cap.
//
// `req.json()` buffers the whole body, and a `content-length` check alone is
// no cap: a chunked request has no such header (`Number('') === 0` passes), and
// nginx forwards chunked bodies unbuffered up to `client_max_body_size`. This
// reads the stream and stops at the cap instead of trusting the header.

export type CappedJson =
  | { ok: true; value: unknown }
  | { ok: false; error: 'payload_too_large' | 'invalid_json' };

export async function readJsonCapped(req: Request, maxBytes: number): Promise<CappedJson> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: 'payload_too_large' };
  if (!req.body) return { ok: false, error: 'invalid_json' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: 'payload_too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}
