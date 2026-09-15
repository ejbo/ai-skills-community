// How a stored file is DESCRIBED to a reader — the size string, the EXT slot of
// a card's meta line and the 下载 href. One copy for every surface that shows
// an attachment: 技术专区 (body embed card, composer ledger, post rail, preview
// panel footer + fullscreen toolbar, the viewer's download card) and 讨论区
// (file card, picker row, viewer drawer header).
//
// They used to be spelled out per surface, and the copies drifted in ways a
// reader could see on ONE screen: the 讨论区 card rounded 1,536 bytes to "2 KB"
// while the drawer it opened said "1.5 KB"; the zone cards fell back to the raw
// client MIME (`application/octet-stream`, which wrapped the rail row onto two
// lines) for an extension-less upload where 讨论区 showed nothing; and the
// `${withBasePath(url)}?name=…` download rule existed five times.
//
// Client-safe (no React, no next-intl — callers pass translated text in) and
// deliberately NOT folded into lib/files/file-types.ts, which stays import-free:
// the href needs lib/base-path.

import { withBasePath } from '@/lib/base-path';

/** `14 B`, `1.5 KB`, `12 KB`, `3.2 MB` — one decimal under 10, whole numbers above. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * The 下载 link of a stored file: its root-relative media URL with the display
 * name in `?name=`. The media routes force the KEY's extension onto that name
 * (lib/uploads/serve.ts `safeDownloadName`), so whoever builds the link cannot
 * turn a `.txt` key into `run.bat`; an empty name downloads as `attachment.<ext>`.
 */
export function fileDownloadHref(url: string, name: string | null | undefined): string {
  return `${withBasePath(url)}?name=${encodeURIComponent(name || 'attachment')}`;
}

/**
 * The meta line of a file card, as its parts: the TYPE slot, then the size.
 *
 * The type slot is the display extension upper-cased (`PY`, `TAR.GZ`) — the
 * caller passes what `displayExtOf` resolved — and `genericLabel` (a localized
 * 文件 / FILE) when there is none: an extension-less `Makefile` / `LICENSE`
 * stores under a `bin` key, and neither that placeholder nor the client MIME
 * type is ever shown. The size is omitted when unknown (a legacy row with 0).
 */
export function fileMetaParts(ext: string | null | undefined, sizeBytes: number | null | undefined, genericLabel: string): string[] {
  const type = (ext ?? '').trim().toUpperCase() || genericLabel;
  const parts = type ? [type] : [];
  if (sizeBytes != null && sizeBytes > 0) parts.push(formatBytes(sizeBytes));
  return parts;
}
