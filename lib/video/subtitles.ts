// 字幕 pipeline (短视频 AND 长视频) — SERVER-ONLY, best-effort by contract (a box
// without the tooling must never break uploads):
//   1. ffmpeg extracts mono 16 kHz audio from the stored source.
//   2. A LOCAL whisper binary transcribes it to VTT (auto language detection).
//      Two flavors are supported, whichever is installed:
//        - whisper.cpp   (`whisper-cli`, needs WHISPER_MODEL=/path/to/ggml-*.bin)
//        - openai-whisper (`whisper`,   Python CLI; model name via WHISPER_MODEL,
//          default 'base', weights auto-downloaded to ~/.cache/whisper)
//      Override the binary with WHISPER_BIN.
//   3. The house LLM (getLibraryProvider — admin-repointable) translates the
//      cues to the OTHER language (中 ↔ EN), preserving timestamps. Translation
//      failure still ships the original track.
//   4. The source-language track becomes a timestamped transcript
//      (Video.subtitleTranscript, lib/video/transcript.ts) — the AI summary and
//      chat read it as background — and a LONG video's summary is refreshed,
//      since it can now be about what was actually said.
// Files land in the videos storage as `subtitle/<nanoid>.vtt`, served by the
// existing auth+Range file route (contentTypeForKey knows .vtt).
//
// Tracks can also be UPLOADED (VTT / SRT) per language by whoever manages the
// video — for a box with no whisper, or to replace a mis-heard ASR track with a
// corrected one (saveUploadedSubtitleTrack / removeSubtitleTrack below).
//
// ADMISSION CONTROL: one ASR run is minutes-to-hours of 100%-CPU, multi-GB-RSS
// work on a box that also carries PostgreSQL and two neighbour apps, and the
// publish route fires this `void`-style — five uploads in the same minute used
// to mean five whisper processes. Jobs therefore queue on an in-process FIFO
// (env.SUBTITLE_CONCURRENCY, default 1), and whisper's own thread pool is capped
// so the one job that does run cannot take the whole machine either. Shorts are
// picked ahead of long videos that are still WAITING (a 90-minute talk must not
// make every short published after it wait hours); a job already running is
// never pre-empted.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getLibraryProvider } from '@/lib/library/llm';
import { deleteVideoFile, videoFileAbsPath, videoPublicUrl } from './storage';
import { buildVtt, detectSubtitleLang, parseVtt, toTimedCues, type SubtitleLang, type VttCue } from './subtitles-shared';
import { translateCuesWith } from './subtitle-translate';
import { refreshVideoSummaryIfStale } from './summary';
import { cuesToTranscript } from './transcript';

// ── Tool probing ─────────────────────────────────────────────────────────────

type WhisperFlavor = { bin: string; flavor: 'cpp' | 'openai' } | null;

let whisperProbe: Promise<WhisperFlavor> | null = null;

function probeBin(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(bin, args, { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Detect an installed whisper binary once (cached). Zero-config deploys: the
 * server only needs whisper.cpp built at `~/whisper.cpp` (the deploy-guide
 * location — systemd's PATH never includes user-built binaries) or a binary on
 * PATH; `WHISPER_BIN` is the explicit override.
 */
export function detectWhisper(): Promise<WhisperFlavor> {
  if (!whisperProbe) {
    whisperProbe = (async () => {
      const override = process.env.WHISPER_BIN?.trim();
      const candidates: { bin: string; flavor: 'cpp' | 'openai' }[] = override
        ? [
            { bin: override, flavor: override.includes('whisper-cli') || override.endsWith('main') ? 'cpp' : 'openai' },
          ]
        : [
            { bin: 'whisper-cli', flavor: 'cpp' },
            { bin: path.join(os.homedir(), 'whisper.cpp', 'build', 'bin', 'whisper-cli'), flavor: 'cpp' },
            { bin: 'whisper', flavor: 'openai' },
          ];
      for (const c of candidates) {
        // Both flavors exit 0 on --help / -h.
        if (await probeBin(c.bin, c.flavor === 'cpp' ? ['-h'] : ['--help'])) return c;
      }
      return null;
    })();
  }
  return whisperProbe;
}

// Best → worst; both languages (中/EN) benefit from the larger models.
const GGML_MODEL_PREFERENCE = [
  'large-v3-turbo',
  'large-v3',
  'large',
  'medium',
  'small',
  'base',
  'tiny',
];

/**
 * Resolve the ggml model for whisper.cpp: `WHISPER_MODEL` override, else the
 * best `ggml-*.bin` found in `~/models` or `<LOCAL_STORAGE_DIR>/models` — so a
 * pull-only server just drops the file there and restarts.
 */
export function resolveCppModel(): string | null {
  const override = process.env.WHISPER_MODEL?.trim();
  if (override) return fs.existsSync(override) ? override : null;
  const dirs = [
    path.join(os.homedir(), 'models'),
    path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './storage', 'models'),
  ];
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.startsWith('ggml-') && f.endsWith('.bin'));
    } catch {
      continue;
    }
    for (const pref of GGML_MODEL_PREFERENCE) {
      if (files.includes(`ggml-${pref}.bin`)) return path.join(dir, `ggml-${pref}.bin`);
    }
    if (files.length > 0) return path.join(dir, files.sort()[0]);
  }
  return null;
}

export async function subtitlesAvailable(): Promise<boolean> {
  const w = await detectWhisper();
  if (!w) return false;
  if (w.flavor === 'cpp') return resolveCppModel() !== null;
  return true;
}

type RunOutcome = 'ok' | 'timeout' | 'failed';

/**
 * Spawn a tool under a HARD timeout. Every outcome — including the timeout — is
 * a resolved value, never a rejection: a subtitle failure may only ever land on
 * the row (see the module header). `extraEnv` caps thread pools through the
 * environment, which — unlike a CLI flag — an older build cannot reject.
 */
function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    try {
      const p = spawn(bin, args, {
        stdio: 'ignore',
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        // Resolve WITHOUT waiting for 'close': a child stuck in uninterruptible
        // IO can outlive its SIGKILL, and waiting on it would wedge the FIFO
        // behind a process nothing can reap.
        resolve('timeout');
      }, timeoutMs);
      p.on('error', () => {
        clearTimeout(timer);
        resolve('failed');
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? 'ok' : 'failed');
      });
    } catch {
      resolve('failed');
    }
  });
}

// ── Storage helper (subtitle/ namespace inside the videos root) ──────────────

async function saveSubtitleVtt(content: string): Promise<{ key: string; url: string } | null> {
  const key = `subtitle/${nanoid()}.vtt`;
  const full = videoFileAbsPath(key);
  if (!full) return null;
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return { key, url: videoPublicUrl(key) };
}

// ── LLM cue translation ──────────────────────────────────────────────────────
// The retry / split / fallback machinery is pure and lives in
// ./subtitle-translate.ts (unit-tested with a fake model); this is only the
// binding to the house LLM.

/**
 * Translate cue texts to the target language with the admin-repointable library
 * provider. null ⇒ the LLM is unconfigured, unreachable, or too unreliable to
 * ship a track (the caller keeps only the original language).
 */
async function translateCues(cues: VttCue[], target: SubtitleLang): Promise<VttCue[] | null> {
  let provider: Awaited<ReturnType<typeof getLibraryProvider>>['provider'];
  try {
    provider = (await getLibraryProvider()).provider;
  } catch {
    return null; // LLM unconfigured — original-language track only
  }
  return translateCuesWith(cues, target, async (system, user) => {
    const res = await provider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      // No maxTokens: the provider omits the field so a reasoning model's
      // <think> block can't truncate the answer (house rule).
    });
    return res.text;
  });
}

// ── The pipeline ─────────────────────────────────────────────────────────────

// Uploads have NO duration cap, so give long videos generous processing room.
const AUDIO_TIMEOUT_MS = 20 * 60 * 1000;
// The floor suits any short; a LONG video scales with its own length — on the
// capped thread pool whisper runs near real time, so a fixed 90 min killed every
// talk longer than about an hour. 4× real time is slack for a slow box, 12 h is
// the point past which the child is stuck rather than slow.
const WHISPER_TIMEOUT_FLOOR_MS = 90 * 60 * 1000;
const WHISPER_TIMEOUT_CEIL_MS = 12 * 60 * 60 * 1000;
const WHISPER_REALTIME_FACTOR = 4;

export function whisperTimeoutMs(durationSec: number | null | undefined): number {
  const scaled = (durationSec && durationSec > 0 ? durationSec : 0) * 1000 * WHISPER_REALTIME_FACTOR;
  return Math.min(WHISPER_TIMEOUT_CEIL_MS, Math.max(WHISPER_TIMEOUT_FLOOR_MS, scaled));
}

// Both whisper flavors default to "every core", which starves PostgreSQL and the
// two neighbour apps sharing this box for as long as a job runs.
const WHISPER_THREADS = Math.max(1, env.WHISPER_THREADS);
// OpenMP/torch honour this without a CLI flag — safe for every flavor and every
// release, whereas an unknown ARGUMENT makes the CLI exit non-zero and would
// turn every job into 转写失败.
const THREAD_ENV: Record<string, string> = {
  OMP_NUM_THREADS: String(WHISPER_THREADS),
  MKL_NUM_THREADS: String(WHISPER_THREADS),
};

type Transcription = { vtt: string } | { error: string };

function transcribeError(outcome: RunOutcome): string {
  return outcome === 'timeout' ? 'whisper 转写超时' : 'whisper 转写失败';
}

async function transcribeToVtt(audioPath: string, workDir: string, timeoutMs: number): Promise<Transcription> {
  const w = await detectWhisper();
  if (!w) return { error: 'whisper 不可用' };
  const outBase = path.join(workDir, 'out');
  if (w.flavor === 'cpp') {
    const model = resolveCppModel();
    if (!model) return { error: 'whisper 模型文件不存在' };
    // `-t` is whisper.cpp's own thread flag; openai-whisper's flag set differs,
    // so the cap there rides on THREAD_ENV alone.
    const outcome = await run(
      w.bin,
      ['-m', model, '-t', String(WHISPER_THREADS), '-f', audioPath, '-l', 'auto', '-ovtt', '-of', outBase],
      timeoutMs,
      THREAD_ENV,
    );
    if (outcome !== 'ok') return { error: transcribeError(outcome) };
    const vtt = await fsp.readFile(`${outBase}.vtt`, 'utf8').catch(() => null);
    return vtt === null ? { error: 'whisper 未输出字幕文件' } : { vtt };
  }
  // openai-whisper writes <audio-basename>.vtt into --output_dir. WHISPER_MODEL
  // here is a model NAME (turbo/small/base…), not a ggml path.
  const raw = process.env.WHISPER_MODEL?.trim();
  const model = raw && !raw.includes('/') ? raw : 'base';
  const outcome = await run(
    w.bin,
    [
      audioPath,
      '--model', model,
      '--output_format', 'vtt',
      '--output_dir', workDir,
      '--fp16', 'False',
      '--verbose', 'False',
    ],
    timeoutMs,
    THREAD_ENV,
  );
  if (outcome !== 'ok') return { error: transcribeError(outcome) };
  const vttPath = path.join(
    workDir,
    `${path.basename(audioPath, path.extname(audioPath))}.vtt`,
  );
  const vtt = await fsp.readFile(vttPath, 'utf8').catch(() => null);
  return vtt === null ? { error: 'whisper 未输出字幕文件' } : { vtt };
}

// ── admission control (in-process FIFO, same shape as zones/office-preview) ──

const CONCURRENCY = Math.max(1, env.SUBTITLE_CONCURRENCY);

type Job = { videoId: string; isShort: boolean; done: () => void };

const queue: Job[] = [];
const queued = new Set<string>();
let running = 0;

/** FIFO within a kind, shorts ahead of long videos that are still waiting (see the header). */
function takeNextJob(): Job | undefined {
  const i = queue.findIndex((j) => j.isShort);
  return i > 0 ? queue.splice(i, 1)[0] : queue.shift();
}

function pump(): void {
  while (running < CONCURRENCY) {
    const job = takeNextJob();
    if (!job) return;
    running++;
    // runSubtitleJob never rejects, but the .catch keeps a rejecting job from
    // skipping the finally and wedging the queue at running === CONCURRENCY.
    runSubtitleJob(job.videoId)
      .catch(() => undefined)
      .finally(() => {
        queued.delete(job.videoId);
        running--;
        job.done();
        // Yield so a burst of publishes cannot starve the event loop.
        setImmediate(pump);
      });
  }
}

/** Queued + running job count (diagnostics / tests). */
export function subtitleQueueSize(): number {
  return queue.length + running;
}

// ── stale-claim recovery ────────────────────────────────────────────────────
//
// The row is claimed in the DB at ENQUEUE time, so a process that dies mid-job
// leaves it at 'processing' forever — and the retry endpoint refuses exactly
// that status, so 重试 answers {status:'processing'} for good. This is the
// COMMON case, not an exotic one: the deploy sequence is build + `systemctl
// restart`, and the unit's TimeoutStopSec/KillMode SIGKILL a running whisper.
// The sweep resets those orphans to 'failed', which IS a state 重试 accepts.
// Deliberately NOT re-queued: a restart must not fire a whisper storm nobody
// asked for.
//
// `subtitleAt` is therefore a LEASE, not merely a start stamp: it is written at
// claim time and RENEWED while this process holds the row (queued OR running),
// so an expired lease means the holder is gone. That is what lets the cutoff be
// minutes instead of hours. Without a lease it would have to exceed the longest
// a live job could legitimately sit silent — 100 min of hard tool timeouts plus
// however long it waited behind SUBTITLE_CONCURRENCY — and the 200 min that came
// out of that arithmetic meant a row stranded seconds ago by a deploy was never
// old enough to rescue.
const LEASE_RENEW_MS = 2 * 60_000;
// Five missed renewals — slack for a stalled event loop or a brief DB outage,
// still ~15× shorter than one whisper timeout.
const STALE_PROCESSING_MS = 5 * LEASE_RENEW_MS;
const STALE_SWEEP_LIMIT = 50;
const STALE_ERROR = '字幕任务已中断（服务重启或超时），可重新生成';
// Between sweeps the call is free, so this only bounds how long a stranded row
// waits: the first sweep after boot runs before the row is old enough to be
// swept, and it is the NEXT one that rescues it.
const STALE_SWEEP_TTL_MS = 10 * 60_000;

let leaseTimer: ReturnType<typeof setInterval> | null = null;

/** Renew every lease this process still holds — one statement for all of them. */
function renewLeases(): void {
  const ids = [...queued];
  if (ids.length === 0) {
    // Nothing held any more; stop ticking until the next enqueue.
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
    return;
  }
  void prisma.video
    .updateMany({
      where: { id: { in: ids }, subtitleStatus: 'processing' },
      data: { subtitleAt: new Date() },
    })
    // Best-effort: a missed renewal only risks a sweep, and `queued` below is
    // the local backstop for exactly that (a DB blip cannot orphan our own job).
    .catch(() => undefined);
}

function ensureLeaseTimer(): void {
  if (leaseTimer) return;
  const timer = setInterval(renewLeases, LEASE_RENEW_MS);
  timer.unref?.(); // a heartbeat must never hold the process open
  leaseTimer = timer;
}

let sweepInFlight: Promise<number> | null = null;
let lastSweepAt = 0;

/**
 * Reset subtitle rows stranded at 'processing'. De-duplicated while a sweep is
 * in flight and rate-limited to one run per STALE_SWEEP_TTL_MS — between runs it
 * returns an already-resolved promise, so the request path pays nothing. Never
 * throws.
 *
 * Deliberately NOT memoized for the life of the process: the rows a deploy
 * strands are seconds old when the first publish/retry after boot arrives, so a
 * one-shot sweep is guaranteed to find nothing — and would then block every
 * later attempt, which is how this feature came to rescue nothing at all.
 * @returns rows reset (0 when the call was skipped).
 */
export function sweepStaleSubtitles(): Promise<number> {
  if (sweepInFlight) return sweepInFlight;
  if (Date.now() - lastSweepAt < STALE_SWEEP_TTL_MS) return Promise.resolve(0);
  // .catch here as well as inside: a rejection reaching the detached `void`
  // call would be an unhandled rejection, i.e. a crash.
  const sweep = runStaleSweep()
    .catch(() => 0)
    .finally(() => {
      // Stamped on FINISH, so a slow sweep cannot immediately re-run itself.
      lastSweepAt = Date.now();
      sweepInFlight = null;
    });
  sweepInFlight = sweep;
  return sweep;
}

async function runStaleSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  // subtitleAt is the lease (claim + renewals); rows claimed by an older build
  // have none, so fall back to the row's own updatedAt — which can only be
  // NEWER than the claim, i.e. the fallback errs toward leaving a job alone.
  const stale = {
    subtitleStatus: 'processing' as const,
    OR: [{ subtitleAt: { lt: cutoff } }, { subtitleAt: null, updatedAt: { lt: cutoff } }],
  };
  try {
    const rows = await prisma.video.findMany({
      where: stale,
      orderBy: { updatedAt: 'asc' },
      take: STALE_SWEEP_LIMIT,
      select: { id: true },
    });
    let reset = 0;
    for (const r of rows) {
      // We hold it (waiting its turn behind the FIFO, or running). Its lease
      // should already be fresh; this also covers the case where the renewals
      // themselves failed, so a DB blip can never orphan our own live job.
      if (queued.has(r.id)) continue;
      // Guarded claim (the site-wide updateMany pattern): count 0 means another
      // process swept it first, or the job finished while we were looking. It
      // is also what makes a repeat sweep a no-op — a row we already reset no
      // longer matches `subtitleStatus: 'processing'`.
      const done = await prisma.video.updateMany({
        where: { id: r.id, ...stale },
        data: { subtitleStatus: 'failed', subtitleError: STALE_ERROR },
      });
      reset += done.count;
    }
    return reset;
  } catch {
    return 0; // best-effort — a sweep failure must never reach a request
  }
}

/**
 * Generate 中/EN subtitle tracks for a video — a short OR a long video. Fire-and-
 * forget from the publish routes; also triggered on demand. Claims the row
 * atomically (status → processing) so concurrent triggers never double-run, then
 * queues the actual ASR behind the FIFO. The returned promise settles when the
 * job reaches a terminal state (immediately when there was nothing to claim).
 * NEVER throws.
 */
export async function generateVideoSubtitles(videoId: string): Promise<void> {
  if (!videoId) return;
  // Detached: a publish must never wait on the sweep.
  void sweepStaleSubtitles();
  if (queued.has(videoId)) return; // already waiting/running in this process
  let isShort = false;
  try {
    const claimed = await prisma.video.updateMany({
      where: { id: videoId, deletedAt: null, subtitleStatus: { not: 'processing' } },
      // subtitleAt doubles as the lease: it is the only column recording when
      // 'processing' started, and renewLeases keeps it current for as long as
      // we hold the row. An expired one is what the stale sweep acts on.
      data: { subtitleStatus: 'processing', subtitleError: null, subtitleAt: new Date() },
    });
    if (claimed.count === 0) return; // another trigger (or another process) owns it
    const row = await prisma.video.findUnique({ where: { id: videoId }, select: { isShort: true } });
    isShort = row?.isShort ?? false;
  } catch {
    return; // DB unreachable — best-effort by contract
  }
  if (queued.has(videoId)) return; // enqueued in this process while we awaited the claim
  queued.add(videoId);
  // Renew from ENQUEUE, not from job start: a job waiting behind
  // SUBTITLE_CONCURRENCY holds a claim just as much as a running one, and its
  // lease must not expire while it queues.
  ensureLeaseTimer();
  await new Promise<void>((resolve) => {
    queue.push({ videoId, isShort, done: () => resolve() });
    pump();
  });
}

/** The name the shorts routes have always called; same function. */
export const generateShortSubtitles = generateVideoSubtitles;

// ── transcript + track bookkeeping ───────────────────────────────────────────

/** Timestamped transcript of a cue list, or null when it has no usable cues. */
function transcriptOf(cues: VttCue[]): string | null {
  const text = cuesToTranscript(toTimedCues(cues));
  return text || null;
}

async function readTrackCues(key: string | null | undefined): Promise<VttCue[] | null> {
  if (!key) return null;
  const full = videoFileAbsPath(key);
  if (!full) return null;
  const vtt = await fsp.readFile(full, 'utf8').catch(() => null);
  if (vtt === null) return null;
  const cues = parseVtt(vtt);
  return cues.length > 0 ? cues : null;
}

/**
 * Subtitle files have exactly one referent (the row that names them), so a
 * replaced or removed track's file is deleted — unlike a short's MEDIA, which
 * soft-delete keeps. Only ever called with keys read from the row, and only for
 * the `subtitle/` namespace.
 */
async function unlinkSubtitleFiles(keys: (string | null | undefined)[]): Promise<void> {
  for (const key of keys) {
    if (key && key.startsWith('subtitle/')) await deleteVideoFile(key);
  }
}

/** A long video's summary can now be about what was said — refresh it, detached, never throwing. */
function refreshSummaryDetached(videoId: string, isShort: boolean): void {
  if (isShort) return; // AI 摘要 is a long-video concept
  void refreshVideoSummaryIfStale(videoId);
}

/** The queued half: the real work for an already-claimed row. Never throws. */
async function runSubtitleJob(videoId: string): Promise<void> {
  const fail = async (reason: string) => {
    await prisma.video
      .updateMany({
        where: { id: videoId, subtitleStatus: 'processing' },
        data: { subtitleStatus: 'failed', subtitleError: reason.slice(0, 500) },
      })
      .catch(() => undefined);
  };

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { videoKey: true, isShort: true, durationSec: true, subtitleZhKey: true, subtitleEnKey: true },
    });
    const src = video?.videoKey ? videoFileAbsPath(video.videoKey) : null;
    if (!video || !src || !fs.existsSync(src)) {
      await fail('源文件不存在');
      return;
    }
    if (!(await subtitlesAvailable())) {
      await fail('未安装 whisper（whisper-cli 或 openai-whisper）——服务器不支持字幕生成');
      return;
    }

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'video-sub-'));
    try {
      const wav = path.join(workDir, 'audio.wav');
      const audio = await run(
        'ffmpeg',
        ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav],
        AUDIO_TIMEOUT_MS,
      );
      if (audio !== 'ok' || !fs.existsSync(wav)) {
        await fail(audio === 'timeout' ? '音频提取超时' : '音频提取失败（需要 ffmpeg，或视频没有音轨）');
        return;
      }

      const transcription = await transcribeToVtt(wav, workDir, whisperTimeoutMs(video.durationSec));
      if ('error' in transcription) {
        await fail(transcription.error);
        return;
      }
      const cues = parseVtt(transcription.vtt);
      if (cues.length === 0) {
        await fail('未识别到语音内容');
        return;
      }

      const srcLang = detectSubtitleLang(cues);
      const original = await saveSubtitleVtt(buildVtt(cues));
      if (!original) {
        await fail('字幕文件写入失败');
        return;
      }

      // Translate to the other language — optional, original still ships alone.
      const targetLang: SubtitleLang = srcLang === 'zh' ? 'en' : 'zh';
      const translatedCues = await translateCues(cues, targetLang);
      const translated = translatedCues ? await saveSubtitleVtt(buildVtt(translatedCues)) : null;

      const zh = srcLang === 'zh' ? original : translated;
      const en = srcLang === 'en' ? original : translated;
      const stored = await prisma.video.updateMany({
        where: { id: videoId, subtitleStatus: 'processing' },
        data: {
          subtitleStatus: 'ready',
          subtitleSrcLang: srcLang,
          subtitleZhKey: zh?.key ?? null,
          subtitleZhUrl: zh?.url ?? null,
          subtitleEnKey: en?.key ?? null,
          subtitleEnUrl: en?.url ?? null,
          // The transcript is always the VERBATIM track — a translation of a
          // mis-hearing compounds the error instead of letting the model fix it.
          subtitleTranscript: transcriptOf(cues),
          subtitleManual: false, // every track on the row is machine-made again
          subtitleError: translated ? null : 'LLM 翻译不可用，仅生成原文字幕',
          subtitleAt: new Date(),
        },
      });
      if (stored.count === 0) {
        // The row left 'processing' under us (swept, or deleted): nothing names
        // the files we just wrote.
        await unlinkSubtitleFiles([original.key, translated?.key]);
        return;
      }
      await unlinkSubtitleFiles([video.subtitleZhKey, video.subtitleEnKey]);
      refreshSummaryDetached(videoId, video.isShort);
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (e) {
    await prisma.video
      .updateMany({
        where: { id: videoId, subtitleStatus: 'processing' },
        data: {
          subtitleStatus: 'failed',
          subtitleError: e instanceof Error ? e.message.slice(0, 500) : 'unknown',
        },
      })
      .catch(() => undefined);
  }
}

// ── uploaded / removed tracks ────────────────────────────────────────────────

export type TrackWriteResult =
  | { ok: true; status: 'ready' | 'none' }
  | { ok: false; error: 'not_found' | 'busy' | 'write_failed' };

/**
 * Store an UPLOADED track (already parsed + canonicalised by parseSubtitleFile)
 * as this video's `lang` subtitles, replacing whatever was there. Refused while
 * an ASR job owns the row ('busy') — the job would overwrite the upload when it
 * finishes. The transcript is rebuilt from the source-language track (the
 * upload itself when it IS that language, or when no other track exists).
 *
 * `translate: true` additionally asks the house LLM for the OTHER language,
 * detached: the upload answers at once and the second track appears when done.
 */
export async function saveUploadedSubtitleTrack(
  videoId: string,
  lang: SubtitleLang,
  cues: VttCue[],
  opts: { translate?: boolean } = {},
): Promise<TrackWriteResult> {
  const video = await prisma.video.findFirst({
    where: { id: videoId, deletedAt: null },
    select: { isShort: true, subtitleStatus: true, subtitleSrcLang: true, subtitleZhKey: true, subtitleEnKey: true },
  });
  if (!video) return { ok: false, error: 'not_found' };
  if (video.subtitleStatus === 'processing') return { ok: false, error: 'busy' };

  const saved = await saveSubtitleVtt(buildVtt(cues));
  if (!saved) return { ok: false, error: 'write_failed' };

  const otherKey = lang === 'zh' ? video.subtitleEnKey : video.subtitleZhKey;
  // The upload becomes the source language unless the OTHER track already is it.
  const other: SubtitleLang = lang === 'zh' ? 'en' : 'zh';
  const srcLang: SubtitleLang = otherKey && video.subtitleSrcLang === other ? other : lang;
  const transcriptCues = srcLang === lang ? cues : ((await readTrackCues(otherKey)) ?? cues);

  const done = await prisma.video.updateMany({
    // Guarded like every other write here: an ASR job that claimed the row
    // between the read and now wins, and the file we wrote is dropped.
    where: { id: videoId, subtitleStatus: { not: 'processing' } },
    data: {
      subtitleStatus: 'ready',
      subtitleSrcLang: srcLang,
      ...(lang === 'zh'
        ? { subtitleZhKey: saved.key, subtitleZhUrl: saved.url }
        : { subtitleEnKey: saved.key, subtitleEnUrl: saved.url }),
      subtitleTranscript: transcriptOf(transcriptCues),
      subtitleManual: true, // a person's work — never regenerated over on the pipeline's own initiative
      subtitleError: null,
      subtitleAt: new Date(),
    },
  });
  if (done.count === 0) {
    await unlinkSubtitleFiles([saved.key]);
    return { ok: false, error: 'busy' };
  }
  await unlinkSubtitleFiles([lang === 'zh' ? video.subtitleZhKey : video.subtitleEnKey]);
  refreshSummaryDetached(videoId, video.isShort);
  if (opts.translate) void translateUploadedTrack(videoId, lang, cues);
  return { ok: true, status: 'ready' };
}

/** Detached second half of an upload with `translate`: fill the OTHER language from the uploaded cues. Never throws. */
async function translateUploadedTrack(videoId: string, from: SubtitleLang, cues: VttCue[]): Promise<void> {
  try {
    const target: SubtitleLang = from === 'zh' ? 'en' : 'zh';
    const translated = await translateCues(cues, target);
    if (!translated) {
      await prisma.video
        .updateMany({
          where: { id: videoId, subtitleStatus: 'ready' },
          data: { subtitleError: 'LLM 翻译不可用，未生成另一语言字幕' },
        })
        .catch(() => undefined);
      return;
    }
    const saved = await saveSubtitleVtt(buildVtt(translated));
    if (!saved) return;
    const before = await prisma.video.findUnique({
      where: { id: videoId },
      select: { subtitleZhKey: true, subtitleEnKey: true },
    });
    const done = await prisma.video.updateMany({
      where: { id: videoId, subtitleStatus: 'ready' },
      data:
        target === 'zh'
          ? { subtitleZhKey: saved.key, subtitleZhUrl: saved.url, subtitleError: null }
          : { subtitleEnKey: saved.key, subtitleEnUrl: saved.url, subtitleError: null },
    });
    if (done.count === 0) {
      await unlinkSubtitleFiles([saved.key]);
      return;
    }
    await unlinkSubtitleFiles([target === 'zh' ? before?.subtitleZhKey : before?.subtitleEnKey]);
  } catch {
    /* best-effort */
  }
}

/** Remove one language's track (file included). The last track gone ⇒ status 'none', transcript cleared. */
export async function removeSubtitleTrack(videoId: string, lang: SubtitleLang): Promise<TrackWriteResult> {
  const video = await prisma.video.findFirst({
    where: { id: videoId, deletedAt: null },
    select: { isShort: true, subtitleStatus: true, subtitleSrcLang: true, subtitleZhKey: true, subtitleEnKey: true },
  });
  if (!video) return { ok: false, error: 'not_found' };
  if (video.subtitleStatus === 'processing') return { ok: false, error: 'busy' };

  const removedKey = lang === 'zh' ? video.subtitleZhKey : video.subtitleEnKey;
  const keptKey = lang === 'zh' ? video.subtitleEnKey : video.subtitleZhKey;
  const kept: SubtitleLang = lang === 'zh' ? 'en' : 'zh';
  const keptCues = await readTrackCues(keptKey);
  const status = keptKey ? 'ready' : 'none';

  const done = await prisma.video.updateMany({
    where: { id: videoId, subtitleStatus: { not: 'processing' } },
    data: {
      subtitleStatus: status,
      subtitleSrcLang: keptKey ? kept : null,
      ...(lang === 'zh' ? { subtitleZhKey: null, subtitleZhUrl: null } : { subtitleEnKey: null, subtitleEnUrl: null }),
      subtitleTranscript: keptCues ? transcriptOf(keptCues) : null,
      ...(keptKey ? {} : { subtitleManual: false }),
      subtitleError: null,
      subtitleAt: new Date(),
    },
  });
  if (done.count === 0) return { ok: false, error: 'busy' };
  await unlinkSubtitleFiles([removedKey]);
  refreshSummaryDetached(videoId, video.isShort);
  return { ok: true, status };
}
