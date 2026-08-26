// 技术专区 office attachments (ppt/pptx/doc/docx/xls/xlsx) → PDF preview via a
// local LibreOffice, plus the slides/sections HTML fallback used when no
// soffice is installed (or the conversion failed).
//
// Best-effort by design: NOTHING here throws to a caller. Conversion runs in an
// in-process FIFO with concurrency 1 (LibreOffice is memory-hungry and its
// user profile does not like concurrent headless instances), deduped by
// attachment id, and every outcome lands on the ZonePostAttachment row
// (`previewStatus` pending → ready | failed, `previewError` short code/message)
// so the UI can poll `/attachments/[id]/preview` and offer 重试.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { extractDocx, extractPptx } from '@/lib/library/extract-office';
import { extOfName, isOfficePreviewable } from './shared';
import { deleteZoneMediaFile, newZoneMediaKey, zoneMediaAbsPath, zoneMediaPublicUrl } from './storage';

const CONVERT_TIMEOUT_MS = 180_000;
const MAX_ERROR_LEN = 200;
const MAX_HTML_SECTIONS = 200;
const MAX_EXTRACT_BYTES = 64 * 1024 * 1024; // OOXML text extraction reads the whole zip into memory

// ── soffice discovery ────────────────────────────────────────────────────────

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/snap/bin/libreoffice',
  '/usr/bin/libreoffice',
  '/opt/libreoffice/program/soffice',
];

let sofficeCache: { path: string | null } | null = null;

function whichBinary(name: string): string | null {
  try {
    const out = execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3_000 })
      .toString()
      .trim();
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Locate LibreOffice once per process: `SOFFICE_BIN` override → `soffice` /
 * `libreoffice` on PATH → the usual macOS / Homebrew / Debian / snap paths.
 * systemd units carry a minimal PATH, which is why the absolute candidates
 * exist. Cached (including a miss) — installing soffice needs a restart.
 */
export function findSofficeBinary(): string | null {
  if (sofficeCache) return sofficeCache.path;
  let found: string | null = null;
  const override = (process.env.SOFFICE_BIN ?? '').trim();
  if (override && fs.existsSync(override)) found = override;
  if (!found) found = whichBinary('soffice') ?? whichBinary('libreoffice');
  if (!found) found = SOFFICE_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
  sofficeCache = { path: found };
  return found;
}

/** Test seam: forget the cached discovery result. */
export function resetSofficeCache(): void {
  sofficeCache = null;
}

// ── queue ────────────────────────────────────────────────────────────────────

const queue: string[] = [];
const queued = new Set<string>();
let running = false;

// The queue is in-process only, so a row left `pending` by a restart (or a
// crashed conversion) would poll 转换中 forever. One bounded, best-effort sweep
// per process re-queues those; anything younger than two conversion timeouts
// may still legitimately be waiting behind other jobs in THIS process.
const STALE_PENDING_MS = Math.max(10 * 60_000, CONVERT_TIMEOUT_MS * 2);
const STALE_SWEEP_LIMIT = 25;
let sweptStale = false;

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'conversion_failed';
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_ERROR_LEN ? oneLine.slice(0, MAX_ERROR_LEN) : oneLine || 'conversion_failed';
}

async function setStatus(
  attachmentId: string,
  data: {
    previewStatus: 'none' | 'pending' | 'ready' | 'failed' | 'unsupported';
    previewKey?: string | null;
    previewUrl?: string | null;
    previewError?: string | null;
  },
): Promise<boolean> {
  try {
    const r = await prisma.zonePostAttachment.updateMany({ where: { id: attachmentId }, data });
    return r.count > 0;
  } catch {
    return false;
  }
}

function attachmentExt(row: { name: string; key: string; mimeType: string }): string {
  return extOfName(row.name) || extOfName(row.key) || extFromMime(row.mimeType);
}

function extFromMime(mime: string): string {
  switch (mime.split(';')[0].trim().toLowerCase()) {
    case 'application/vnd.ms-powerpoint':
      return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/pdf':
      return 'pdf';
    default:
      return '';
  }
}

function pump(): void {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  generateOfficePreview(next)
    .catch(() => undefined)
    .finally(() => {
      queued.delete(next);
      running = false;
      // Yield so a burst of schedules cannot starve the event loop.
      setImmediate(pump);
    });
}

/**
 * Re-queue attachments this process never claimed but that are still `pending`
 * (a restart or a crashed conversion left them there). Once per process,
 * bounded, detached — never throws into the caller's request path.
 */
function sweepStalePending(): void {
  if (sweptStale) return;
  sweptStale = true;
  void (async () => {
    try {
      const rows = await prisma.zonePostAttachment.findMany({
        where: { previewStatus: 'pending', createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
        orderBy: { createdAt: 'asc' },
        take: STALE_SWEEP_LIMIT,
        select: { id: true },
      });
      let added = false;
      for (const r of rows) {
        if (queued.has(r.id)) continue; // already claimed by this process
        queued.add(r.id);
        queue.push(r.id);
        added = true;
      }
      // generateOfficePreview re-validates each row, so a swept attachment that
      // is no longer convertible ends terminally (unsupported / failed).
      if (added) pump();
    } catch {
      /* swallowed — best-effort */
    }
  })();
}

/**
 * Enqueue a conversion. Marks the row `pending` when this call actually claims
 * the work (or `unsupported` for a kind LibreOffice cannot help with) so the UI
 * shows 转换中 immediately; the actual conversion runs on the FIFO. The dedupe
 * check comes FIRST — writing `pending` for an attachment whose conversion is
 * already queued (and may be finishing right now) would pin a `ready` row back
 * to 转换中 forever. Fire-and-forget, never throws.
 */
export function scheduleOfficePreview(attachmentId: string): void {
  if (!attachmentId) return;
  sweepStalePending();
  if (queued.has(attachmentId)) return;
  void (async () => {
    try {
      const row = await prisma.zonePostAttachment.findUnique({
        where: { id: attachmentId },
        select: { id: true, kind: true, key: true, name: true, mimeType: true },
      });
      if (!row) return;
      if (row.kind !== 'file' || !isOfficePreviewable(attachmentExt(row))) {
        await setStatus(attachmentId, { previewStatus: 'unsupported', previewError: null });
        return;
      }
      if (queued.has(attachmentId)) return; // claimed while we were reading the row
      queued.add(attachmentId);
      try {
        await setStatus(attachmentId, { previewStatus: 'pending', previewError: null });
      } finally {
        // Queue it whatever the status write did, or the claim above would
        // block every later schedule for this attachment.
        queue.push(attachmentId);
        pump();
      }
    } catch {
      /* swallowed — best-effort */
    }
  })();
}

/** Queue depth (for diagnostics / tests). */
export function officePreviewQueueSize(): number {
  return queue.length + (running ? 1 : 0);
}

// ── conversion ───────────────────────────────────────────────────────────────

function runSoffice(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        cwd,
        timeout: CONVERT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, HOME: process.env.HOME || cwd },
      },
      (err, _stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message || '').toString();
          reject(new Error(err.killed ? 'timeout' : detail || 'soffice_failed'));
          return;
        }
        resolve();
      },
    );
  });
}

async function moveFile(from: string, to: string): Promise<void> {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch {
    // tmp dir may live on another filesystem (EXDEV) — copy then unlink
    await fsp.copyFile(from, to);
    await fsp.unlink(from).catch(() => undefined);
  }
}

/**
 * Convert ONE attachment to PDF with `soffice --headless --convert-to pdf`.
 * Outcome is written to the row; the returned promise never rejects.
 */
export async function generateOfficePreview(attachmentId: string): Promise<void> {
  let row: { id: string; kind: string; key: string; name: string; mimeType: string; previewKey: string | null } | null = null;
  try {
    row = await prisma.zonePostAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, kind: true, key: true, name: true, mimeType: true, previewKey: true },
    });
  } catch {
    return;
  }
  if (!row) return;

  const ext = attachmentExt(row);
  if (row.kind !== 'file' || !isOfficePreviewable(ext)) {
    await setStatus(attachmentId, { previewStatus: 'unsupported', previewError: null });
    return;
  }

  const bin = findSofficeBinary();
  if (!bin) {
    await setStatus(attachmentId, { previewStatus: 'failed', previewError: 'soffice_missing' });
    return;
  }

  const abs = zoneMediaAbsPath(row.key);
  if (!abs || !fs.existsSync(abs)) {
    await setStatus(attachmentId, { previewStatus: 'failed', previewError: 'source_missing' });
    return;
  }

  let tmp: string | null = null;
  let producedKey: string | null = null;
  try {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'zone-office-'));
    // A private user profile per run: no lock fights with a desktop
    // LibreOffice, no stale profile from a previous crash, and a HOME-less
    // systemd unit still works.
    const profileDir = path.join(tmp, 'profile');
    await fsp.mkdir(profileDir, { recursive: true });
    const outDir = path.join(tmp, 'out');
    await fsp.mkdir(outDir, { recursive: true });

    await runSoffice(
      bin,
      [
        `-env:UserInstallation=file://${profileDir}`,
        '--headless',
        '--norestore',
        '--nologo',
        '--nolockcheck',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        abs,
      ],
      tmp,
    );

    const produced = (await fsp.readdir(outDir)).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!produced) throw new Error('no_output');
    const producedPath = path.join(outDir, produced);
    const stat = await fsp.stat(producedPath);
    if (stat.size <= 0) throw new Error('empty_output');

    const key = newZoneMediaKey('preview', 'pdf');
    const dest = zoneMediaAbsPath(key);
    if (!dest) throw new Error('bad_preview_key');
    await moveFile(producedPath, dest);
    producedKey = key;

    const updated = await setStatus(attachmentId, {
      previewStatus: 'ready',
      previewKey: key,
      previewUrl: zoneMediaPublicUrl(key),
      previewError: null,
    });
    if (!updated) {
      // Attachment vanished mid-conversion — do not leave an orphan PDF.
      await deleteZoneMediaFile(key);
      return;
    }
    if (row.previewKey && row.previewKey !== key) await deleteZoneMediaFile(row.previewKey);
  } catch (e) {
    if (producedKey) await deleteZoneMediaFile(producedKey);
    await setStatus(attachmentId, { previewStatus: 'failed', previewError: shortError(e) });
  } finally {
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── HTML fallback (pptx / docx only — OOXML text, no LibreOffice needed) ─────

/**
 * Per-slide (pptx) / per-section (docx) sanitized HTML through the 知识库
 * OOXML extractor. Returns null when the format is not OOXML, the file is too
 * large to read into memory, or extraction failed; capped at 200 sections.
 */
export async function extractOfficeHtml(
  attachmentKey: string,
  ext: string,
): Promise<{ title: string | null; html: string }[] | null> {
  const kind = ext.toLowerCase().replace(/^\./, '');
  if (kind !== 'pptx' && kind !== 'docx') return null;
  const abs = zoneMediaAbsPath(attachmentKey);
  if (!abs) return null;
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EXTRACT_BYTES) return null;
    const buf = await fsp.readFile(abs);
    const doc = kind === 'pptx' ? await extractPptx(buf) : await extractDocx(buf);
    return doc.chapters.slice(0, MAX_HTML_SECTIONS).map((c) => ({ title: c.title, html: c.html }));
  } catch {
    return null;
  }
}
