// Text preview bytes → string, for the attachment viewer. Pure (no React, no
// fetch) and unit-tested in tests/file-viewer-pure.test.ts.
//
// Why the viewer decodes bytes itself instead of `res.text()`: `res.text()`
// trusts the response charset (we serve every text-like file as
// `text/plain; charset=utf-8`), so a CSV or TXT exported by Chinese Windows /
// Excel — GBK / GB18030, the common case on this intranet — rendered as
// mojibake. Here UTF-8 is tried FATALLY first and GB18030 is the fallback.
// Excel's "Unicode text" export is UTF-16 with a BOM, which is full of NUL
// bytes; the BOM is checked BEFORE the NUL sniff so it is not called binary.

/** How much of a text file the viewer reads (`Range: bytes=0-…`). */
export const TEXT_PREVIEW_BYTES = 1024 * 1024;
/** JSON up to this size is read whole so it can be pretty-printed. */
export const JSON_PRETTY_MAX_BYTES = 5 * 1024 * 1024;
/** A NUL byte in this many leading bytes ⇒ binary (the same heuristic as lib/skill-parser.ts isProbablyText). */
export const BINARY_SNIFF_BYTES = 8 * 1024;

export type TextEncodingName = 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

function bomOf(bytes: Uint8Array): TextEncodingName | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/** A NUL byte among the first BINARY_SNIFF_BYTES ⇒ not text. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Drops a UTF-8 sequence cut in half by the Range boundary. Without this a
 * valid UTF-8 file whose 1 MiB head ends mid-character fails the FATAL decode
 * and is wrongly re-read as GB18030 — the whole preview turns to mojibake
 * because of its last byte.
 */
export function trimIncompleteUtf8Tail(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  // Walk back over at most 3 continuation bytes to the sequence's lead byte.
  for (let back = 1; back <= Math.min(4, n); back++) {
    const b = bytes[n - back];
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return need > back ? bytes.subarray(0, n - back) : bytes;
  }
  return bytes;
}

function decoder(label: string, fatal: boolean): TextDecoder | null {
  try {
    return new TextDecoder(label, { fatal });
  } catch {
    // A runtime without full ICU may not know gb18030.
    return null;
  }
}

/**
 * Decode a text preview. Returns null when the bytes are binary. `truncated`
 * says the bytes are a HEAD of the file (a multi-byte character may be cut).
 */
export function decodeTextBytes(bytes: Uint8Array, opts: { truncated?: boolean } = {}): DecodedText | null {
  const bom = bomOf(bytes);
  if (bom === 'utf-16le' || bom === 'utf-16be') {
    const even = opts.truncated && bytes.length % 2 === 1 ? bytes.subarray(0, bytes.length - 1) : bytes;
    const text = (decoder(bom, false) ?? new TextDecoder()).decode(even);
    return { text, encoding: bom };
  }
  if (looksBinary(bytes)) return null;
  const head = opts.truncated ? trimIncompleteUtf8Tail(bytes) : bytes;
  const utf8 = decoder('utf-8', true);
  if (utf8) {
    try {
      return { text: utf8.decode(head), encoding: 'utf-8' };
    } catch {
      /* not UTF-8 — fall through to GB18030 */
    }
  }
  const gb = decoder('gb18030', false);
  if (gb) return { text: gb.decode(bytes), encoding: 'gb18030' };
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
}

/** Total size from a 206's `Content-Range: bytes a-b/total` (null when absent or `*`). */
export function totalFromContentRange(header: string | null | undefined): number | null {
  const m = /\/(\d+)\s*$/.exec(header ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
