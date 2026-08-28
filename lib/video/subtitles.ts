// 随刷短视频字幕 pipeline — SERVER-ONLY, best-effort by contract (a box without
// the tooling must never break uploads):
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
// Files land in the videos storage as `subtitle/<nanoid>.vtt`, served by the
// existing auth+Range file route (contentTypeForKey knows .vtt).
//
// ADMISSION CONTROL: one ASR run is minutes-to-hours of 100%-CPU, multi-GB-RSS
// work on a box that also carries PostgreSQL and two neighbour apps, and the
// publish route fires this `void`-style — five uploads in the same minute used
// to mean five whisper processes. Jobs therefore queue on an in-process FIFO
// (env.SUBTITLE_CONCURRENCY, default 1), and whisper's own thread pool is capped
// so the one job that does run cannot take the whole machine either.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getLibraryProvider } from '@/lib/library/llm';
import { videoFileAbsPath, videoPublicUrl } from './storage';
import { buildVtt, detectSubtitleLang, parseVtt, type VttCue } from './subtitles-shared';

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

const TRANSLATE_CHUNK = 30;

/**
 * Translate cue texts to the target language, preserving count/order. Returns
 * null when the LLM is unconfigured or any chunk fails (caller keeps only the
 * original track).
 */
async function translateCues(cues: VttCue[], target: 'zh' | 'en'): Promise<VttCue[] | null> {
  let provider;
  try {
    provider = (await getLibraryProvider()).provider;
  } catch {
    return null; // LLM unconfigured — original-language track only
  }
  const targetName = target === 'zh' ? '简体中文' : 'English';
  const out: VttCue[] = [];
  for (let i = 0; i < cues.length; i += TRANSLATE_CHUNK) {
    const chunk = cues.slice(i, i + TRANSLATE_CHUNK);
    const numbered = chunk.map((c, j) => `${j + 1}. ${c.text.replace(/\n/g, ' ')}`).join('\n');
    try {
      const res = await provider.complete({
        system:
          `你是精准的字幕翻译引擎。把编号列表中的每一行字幕翻译成${targetName}。` +
          '保持行数与编号完全一致，每行格式为 "编号. 译文"。' +
          '保留专有名词、代码与数字的原文形态。不要输出任何解释。',
        messages: [{ role: 'user', content: numbered }],
        // No maxTokens: the provider omits the field so a reasoning model's
        // <think> block can't truncate the answer (house rule).
      });
      const lines = new Map<number, string>();
      for (const raw of res.text.split('\n')) {
        const m = /^\s*(\d+)[.、．]\s*(.+)$/.exec(raw.trim());
        if (m) lines.set(Number(m[1]), m[2].trim());
      }
      for (let j = 0; j < chunk.length; j++) {
        const translated = lines.get(j + 1);
        if (!translated) return null; // count mismatch — don't ship a broken track
        out.push({ start: chunk[j].start, end: chunk[j].end, text: translated });
      }
    } catch {
      return null;
    }
  }
  return out;
}

// ── The pipeline ─────────────────────────────────────────────────────────────

// Uploads have NO duration cap, so give long videos generous processing room.
const AUDIO_TIMEOUT_MS = 10 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 90 * 60 * 1000;

// Both whisper flavors default to "every core", which starves PostgreSQL and the
// two neighbour apps sharing this box for as long as a job runs.
const WHISPER_THREADS = 2;
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

async function transcribeToVtt(audioPath: string, workDir: string): Promise<Transcription> {
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
      WHISPER_TIMEOUT_MS,
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
    WHISPER_TIMEOUT_MS,
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

type Job = { videoId: string; done: () => void };

const queue: Job[] = [];
const queued = new Set<string>();
let running = 0;

function pump(): void {
  while (running < CONCURRENCY) {
    const job = queue.shift();
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
    isShort: true,
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
 * Generate 中/EN subtitle tracks for a short. Fire-and-forget from the publish
 * route; also triggered on demand. Claims the row atomically (status →
 * processing) so concurrent triggers never double-run, then queues the actual
 * ASR behind the FIFO. The returned promise settles when the job reaches a
 * terminal state (immediately when there was nothing to claim). NEVER throws.
 */
export async function generateShortSubtitles(videoId: string): Promise<void> {
  if (!videoId) return;
  // Detached: a publish must never wait on the sweep.
  void sweepStaleSubtitles();
  if (queued.has(videoId)) return; // already waiting/running in this process
  try {
    const claimed = await prisma.video.updateMany({
      where: { id: videoId, isShort: true, deletedAt: null, subtitleStatus: { not: 'processing' } },
      // subtitleAt doubles as the lease: it is the only column recording when
      // 'processing' started, and renewLeases keeps it current for as long as
      // we hold the row. An expired one is what the stale sweep acts on.
      data: { subtitleStatus: 'processing', subtitleError: null, subtitleAt: new Date() },
    });
    if (claimed.count === 0) return; // another trigger (or another process) owns it
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
    queue.push({ videoId, done: () => resolve() });
    pump();
  });
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
      select: { videoKey: true },
    });
    const src = video?.videoKey ? videoFileAbsPath(video.videoKey) : null;
    if (!src || !fs.existsSync(src)) {
      await fail('源文件不存在');
      return;
    }
    if (!(await subtitlesAvailable())) {
      await fail('未安装 whisper（whisper-cli 或 openai-whisper）——服务器不支持字幕生成');
      return;
    }

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shorts-sub-'));
    try {
      const wav = path.join(workDir, 'audio.wav');
      const audio = await run(
        'ffmpeg',
        ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav],
        AUDIO_TIMEOUT_MS,
      );
      if (audio !== 'ok' || !fs.existsSync(wav)) {
        await fail(audio === 'timeout' ? '音频提取超时' : '音频提取失败（需要 ffmpeg）');
        return;
      }

      const transcription = await transcribeToVtt(wav, workDir);
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
      const targetLang: 'zh' | 'en' = srcLang === 'zh' ? 'en' : 'zh';
      const translatedCues = await translateCues(cues, targetLang);
      const translated = translatedCues ? await saveSubtitleVtt(buildVtt(translatedCues)) : null;

      const zh = srcLang === 'zh' ? original : translated;
      const en = srcLang === 'en' ? original : translated;
      await prisma.video.updateMany({
        where: { id: videoId, subtitleStatus: 'processing' },
        data: {
          subtitleStatus: 'ready',
          subtitleSrcLang: srcLang,
          subtitleZhKey: zh?.key ?? null,
          subtitleZhUrl: zh?.url ?? null,
          subtitleEnKey: en?.key ?? null,
          subtitleEnUrl: en?.url ?? null,
          subtitleError: translated ? null : 'LLM 翻译不可用，仅生成原文字幕',
          subtitleAt: new Date(),
        },
      });
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
