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

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';
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

function run(bin: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(bin, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(false);
      }, timeoutMs);
      p.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
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

async function transcribeToVtt(audioPath: string, workDir: string): Promise<string | null> {
  const w = await detectWhisper();
  if (!w) return null;
  const outBase = path.join(workDir, 'out');
  if (w.flavor === 'cpp') {
    const model = resolveCppModel();
    if (!model) return null;
    const ok = await run(
      w.bin,
      ['-m', model, '-f', audioPath, '-l', 'auto', '-ovtt', '-of', outBase],
      WHISPER_TIMEOUT_MS,
    );
    if (!ok) return null;
    return fsp.readFile(`${outBase}.vtt`, 'utf8').catch(() => null);
  }
  // openai-whisper writes <audio-basename>.vtt into --output_dir. WHISPER_MODEL
  // here is a model NAME (turbo/small/base…), not a ggml path.
  const raw = process.env.WHISPER_MODEL?.trim();
  const model = raw && !raw.includes('/') ? raw : 'base';
  const ok = await run(
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
  );
  if (!ok) return null;
  const vttPath = path.join(
    workDir,
    `${path.basename(audioPath, path.extname(audioPath))}.vtt`,
  );
  return fsp.readFile(vttPath, 'utf8').catch(() => null);
}

/**
 * Generate 中/EN subtitle tracks for a short. Fire-and-forget from the publish
 * route; also triggered on demand. Claims the row atomically (status →
 * processing) so concurrent triggers never double-run. NEVER throws.
 */
export async function generateShortSubtitles(videoId: string): Promise<void> {
  try {
    const claimed = await prisma.video.updateMany({
      where: { id: videoId, isShort: true, deletedAt: null, subtitleStatus: { not: 'processing' } },
      data: { subtitleStatus: 'processing', subtitleError: null },
    });
    if (claimed.count === 0) return;

    const fail = async (reason: string) => {
      await prisma.video
        .updateMany({
          where: { id: videoId, subtitleStatus: 'processing' },
          data: { subtitleStatus: 'failed', subtitleError: reason.slice(0, 500) },
        })
        .catch(() => undefined);
    };

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
      const audioOk = await run(
        'ffmpeg',
        ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav],
        AUDIO_TIMEOUT_MS,
      );
      if (!audioOk || !fs.existsSync(wav)) {
        await fail('音频提取失败（需要 ffmpeg）');
        return;
      }

      const rawVtt = await transcribeToVtt(wav, workDir);
      if (!rawVtt) {
        await fail('whisper 转写失败');
        return;
      }
      const cues = parseVtt(rawVtt);
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
