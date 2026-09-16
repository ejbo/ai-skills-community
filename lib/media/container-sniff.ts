// 视频容器嗅探 — is an uploaded "video" really a video CONTAINER?
//
// A browser's declared type and the file's extension are both client-chosen, and
// ffmpeg/ffprobe pick their demuxer from the BYTES. So a text file uploaded as
// `video/quicktime` — an `ffconcat` list, an HLS playlist, a DASH manifest, an
// SDP — was stored as `.mov`, probed, and would have been rendered, pulling in
// whatever other file it named. The real guard is the demuxer whitelist on every
// ffmpeg/ffprobe input (lib/media/ffmpeg.ts inputGuardArgs); this sniff is the
// upload-time half, so such a file is refused (400) and deleted before it ever
// gets a key, instead of lingering as an unusable original.
//
// Accepted heads (the containers the upload routes allow):
//   - ISO-BMFF / MP4 / QuickTime: an `ftyp` box type in the first 12 bytes
//     (offset 4 in every writer we know of), or — for pre-2005 QuickTime files
//     that open without `ftyp` — a plausible box size followed by one of the
//     classic top-level atom types at offset 4.
//   - Matroska / WebM: the EBML magic 1A 45 DF A3 at offset 0.
//
// Pure sniff + a never-throwing file-head reader; no env, no keys.

import fsp from 'node:fs/promises';
import path from 'node:path';

/** Bytes a sniff needs (read this many from the head of the file). */
export const VIDEO_CONTAINER_SNIFF_BYTES = 12;

export type VideoContainer = 'isobmff' | 'ebml';

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
/** Top-level QuickTime atoms a legacy `.mov` may open with instead of `ftyp`. */
const LEGACY_QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

function fourcc(b: Uint8Array, at: number): string {
  if (at < 0 || at + 4 > b.length) return '';
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

/** Pure: which video container the head of a file is, or null when it is not one. */
export function sniffVideoContainer(head: Uint8Array): VideoContainer | null {
  if (!(head instanceof Uint8Array)) return null;
  if (head.length >= 4 && EBML_MAGIC.every((v, i) => head[i] === v)) return 'ebml';
  const window = Math.min(head.length, VIDEO_CONTAINER_SNIFF_BYTES);
  for (let at = 0; at + 4 <= window; at++) {
    if (fourcc(head, at) === 'ftyp') return 'isobmff';
  }
  if (head.length >= 8 && LEGACY_QUICKTIME_ATOMS.has(fourcc(head, 4))) {
    // 32-bit box size: 0 (to end of file), 1 (64-bit size follows) or ≥ 8 (header included).
    const size = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
    if (size === 0 || size === 1 || size >= 8) return 'isobmff';
  }
  return null;
}

/**
 * Sniff a file on disk (ABSOLUTE path) by its first VIDEO_CONTAINER_SNIFF_BYTES.
 * null for a non-container, a relative path, a missing/unreadable file. Never throws.
 */
export async function sniffVideoContainerFile(absPath: string): Promise<VideoContainer | null> {
  if (typeof absPath !== 'string' || !path.isAbsolute(absPath)) return null;
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(absPath, 'r');
    const buf = Buffer.alloc(VIDEO_CONTAINER_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return sniffVideoContainer(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
