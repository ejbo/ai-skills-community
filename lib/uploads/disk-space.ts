// Volume-safety guards for the raw-body upload routes: a floor (how much free
// space must remain) and a ceiling (how big a single file may ever be).
//
// WHY it exists: PostgreSQL's data directory sits on the SAME volume as
// LOCAL_STORAGE_DIR on the deploy box, so filling the disk does not merely fail
// an upload — an ENOSPC takes the database (and with it the whole app, plus the
// two neighbour apps sharing the box) down. Uploads are the only thing here
// that can fill a disk unbounded, so they are where the reserve is defended.
//
// Best-effort in ONE direction only: any failure to measure — statfs
// unsupported, path missing, permissions — ALLOWS the upload. A broken check
// must never become an outage of its own.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';

const STORAGE_ROOT = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);

/**
 * Ceiling on any single uploaded file, in bytes.
 *
 * This is a SAFETY cap, not a UX cap: shorts (and 投票 entry videos, and 知识库
 * documents) are deliberately uncapped by product decision, and that stands —
 * their own constants remain Number.MAX_SAFE_INTEGER and the routes clamp with
 * Math.min(product max, MAX_UPLOAD_SAFETY_BYTES). The two must never be
 * merged into one number: a product cap is the owner's call, this is the box's.
 *
 * The 2 GB default is where the box gives up on the file anyway:
 * FASTSTART_MAX_BYTES skips the remux above it, so a larger upload is accepted
 * today only to be served degraded, while costing a multi-GB disk write and a
 * multi-minute request. Above this a file is a stability problem, not a video.
 *
 * MAX_UPLOAD_MB=0 restores "no ceiling" exactly, without a code change — which
 * is the whole reason this is env-derived. The sentinel stays a FINITE number
 * (matching MAX_SHORT_VIDEO_BYTES / MAX_VOTE_VIDEO_BYTES) rather than Infinity:
 * every consumer is a Math.min or a `declared > ceiling` compare, both correct
 * either way, but a finite one also survives Number.isFinite and JSON (Infinity
 * serialises to null) if the value ever reaches a response.
 */
export const MAX_UPLOAD_SAFETY_BYTES =
  env.MAX_UPLOAD_MB > 0 ? env.MAX_UPLOAD_MB * 1024 * 1024 : Number.MAX_SAFE_INTEGER;

/**
 * How long one statfs reading is reused. A bulk 投票 intake fires this once per
 * file (hundreds of files), and the whole point of this audit is to stop paying
 * per-request syscalls on the hot path. Slightly stale is fine: the reserve is
 * measured in GB, far more than a few seconds of uploads can write.
 *
 * The flip side is that a burst of concurrent uploads all read the SAME figure
 * and can collectively overshoot it. That is accepted — this is a guard that
 * keeps a reserve, not a space-accounting ledger.
 */
const CACHE_MS = 5_000;

let cachedFree: number | null = null;
let cachedAt = 0;
let inflight: Promise<number | null> | null = null;

async function measure(dir: string): Promise<number | null> {
  try {
    const st = await fsp.statfs(dir);
    // bavail, not bfree: ext4 reserves ~5% of the filesystem for root and we do
    // not run as root, so bfree promises space the writer cannot actually use.
    return st.bsize * st.bavail;
  } catch {
    return null;
  }
}

/** Free bytes on the storage volume, cached; null when it cannot be measured. */
async function freeBytes(): Promise<number | null> {
  const now = Date.now();
  if (cachedFree !== null && now - cachedAt < CACHE_MS) return cachedFree;
  // A burst of parallel uploads must share ONE syscall, not queue behind N.
  if (inflight) return inflight;
  inflight = (async () => {
    // The storage root may not exist yet on a fresh box; cwd is the same volume
    // in every layout we ship (LOCAL_STORAGE_DIR defaults to ./storage).
    const free = (await measure(STORAGE_ROOT)) ?? (await measure(process.cwd()));
    if (free !== null) {
      cachedFree = free;
      cachedAt = Date.now();
    }
    return free;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * True when this upload may proceed: the volume would still hold at least
 * MIN_FREE_DISK_MB after `bytesNeeded` more bytes land. Pass the declared
 * Content-Length when there is one; 0 checks the reserve alone.
 *
 * MIN_FREE_DISK_MB=0 disables the check entirely (the default is 2 GB, so
 * behaviour only changes on a genuinely full disk).
 */
export async function hasFreeSpace(bytesNeeded = 0): Promise<boolean> {
  const minFree = env.MIN_FREE_DISK_MB * 1024 * 1024;
  if (minFree <= 0) return true;
  const free = await freeBytes();
  if (free === null) return true;
  const need = Number.isFinite(bytesNeeded) && bytesNeeded > 0 ? bytesNeeded : 0;
  return free - need >= minFree;
}
