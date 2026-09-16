// 视频截取 — the reusable server half: lib/media/ffmpeg.ts (process layer + ffprobe
// parsing) and lib/media/video-clip.ts (argument builders + renderers).
//
// Pinned because each one guards a real failure: a path that ffmpeg reads as an
// option, a clip that keeps the phone's location tags or its audio, `-t` placed
// where it trims the INPUT instead of the output, a 24 fps film re-timed to 30,
// an odd output side that libx264 refuses, a portrait video whose display size
// is reported sideways, cover art mistaken for the video stream, and a seek past
// the end that exits 0 with a frameless mp4 (renderClip must not promote it).
// Review round two added: a sub-1 fps (slideshow / variable-rate) source that
// failed every cut, an audio track outlasting the picture that stretched the
// range into frameless time, a text `ffconcat` list uploaded as `.mov` that
// ffprobe/ffmpeg followed into ANOTHER file (the demuxer whitelist must refuse
// it on every input, and the upload sniff must never store it), uncapped encoder
// threads, and a transient "ffmpeg missing" answer cached until restart.
// The render tests run only where ffmpeg exists; the "no ffmpeg on this box"
// path is exercised through the test seam, never by touching the server's env.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VIDEO_INPUT_FORMATS,
  NEGATIVE_AVAILABILITY_TTL_MS,
  buildProbeArgs,
  hasFfmpeg,
  hasFfprobe,
  inputGuardArgs,
  parseDurationTag,
  parseFrameRate,
  parseProbeOutput,
  pickSourceFrameRate,
  probeMediaFile,
  runFfmpeg,
  setMediaToolBinaries,
  videoTimelineSec,
} from '@/lib/media/ffmpeg';
import {
  DEFAULT_MEDIA_THREADS,
  boxScaleFilter,
  buildClipArgs,
  buildFrameArgs,
  clipOutputFps,
  evenBoxScaleFilter,
  ffmpegSeconds,
  renderClip,
  renderFrame,
  tmpOutputPath,
  type ClipArgsOptions,
} from '@/lib/media/video-clip';
import { VIDEO_CONTAINER_SNIFF_BYTES, sniffVideoContainer, sniffVideoContainerFile } from '@/lib/media/container-sniff';

const GUARD = ['-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-protocol_whitelist', 'file'];

const CLIP: ClipArgsOptions = {
  input: '/data/in.mov',
  output: '/data/out/loop.mp4',
  startSec: 10,
  endSec: 35,
  maxEdge: 720,
  fps: 30,
  crf: 28,
  maxrateKbps: 1800,
  mute: true,
};

describe('buildClipArgs', () => {
  it('builds the exact invocation: guarded input, capped threads, input seek, OUTPUT duration, one video stream, no audio, no metadata', () => {
    expect(buildClipArgs(CLIP)).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-filter_threads', '2',
      ...GUARD,
      '-threads', '2',
      '-ss', '10.000',
      '-i', '/data/in.mov',
      '-t', '25.000',
      '-map', '0:V:0',
      '-an',
      '-sn', '-dn',
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', evenBoxScaleFilter(720),
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-maxrate', '1800k', '-bufsize', '3600k',
      '-threads', '2',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-fflags', '+bitexact', '-flags:v', '+bitexact',
      '/data/out/loop.mp4',
    ]);
  });

  it('opens EVERY input under the demuxer/protocol whitelist, before -i (an input option, not an output one)', () => {
    const args = buildClipArgs(CLIP);
    const i = args.indexOf('-i');
    expect(args.indexOf('-format_whitelist')).toBeLessThan(i);
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(i);
    const custom = buildClipArgs({ ...CLIP, inputFormats: ['mov', 'mp4'] });
    expect(custom[custom.indexOf('-format_whitelist') + 1]).toBe('mov,mp4');
  });

  it('caps decoder, filter and encoder threads (default DEFAULT_MEDIA_THREADS, overridable 1–16)', () => {
    expect(DEFAULT_MEDIA_THREADS).toBe(2);
    const args = buildClipArgs({ ...CLIP, threads: 4 });
    const i = args.indexOf('-i');
    const at = args.flatMap((a, k) => (a === '-threads' ? [k] : []));
    expect(at).toHaveLength(2);
    expect(at[0]).toBeLessThan(i); // decoder
    expect(at[1]).toBeGreaterThan(args.indexOf('libx264')); // encoder
    expect(at.map((k) => args[k + 1])).toEqual(['4', '4']);
    expect(args[args.indexOf('-filter_threads') + 1]).toBe('4');
  });

  it('puts -ss before -i and -t after it (so the clip is exactly end − start long)', () => {
    const args = buildClipArgs({ ...CLIP, startSec: 1.25, endSec: 3.5 });
    const i = args.indexOf('-i');
    expect(args.indexOf('-ss')).toBeLessThan(i);
    expect(args.indexOf('-t')).toBeGreaterThan(i);
    expect(args[args.indexOf('-t') + 1]).toBe('2.250');
  });

  it('keeps the first audio stream only when not muted, and omits VBV for pure CRF', () => {
    const args = buildClipArgs({ ...CLIP, mute: false, maxrateKbps: null });
    expect(args).not.toContain('-an');
    expect(args.join(' ')).toContain('-map 0:a:0? -c:a aac -b:a 128k -ac 2');
    expect(args).not.toContain('-maxrate');
    expect(args).not.toContain('-bufsize');
  });

  it('refuses anything that could be read as an option or is not a real range', () => {
    const bad: Partial<ClipArgsOptions>[] = [
      { input: 'in.mov' },
      { input: '-i' },
      { output: '-y' },
      { output: 'relative/out.mp4' },
      { output: CLIP.input },
      { startSec: -1 },
      { endSec: 10 },
      { endSec: Number.NaN },
      { startSec: Number.POSITIVE_INFINITY },
      { maxEdge: 1 },
      { fps: 0 },
      { fps: 0.5 },
      { crf: 60 },
      { maxrateKbps: 10 },
      { threads: 0 },
      { threads: 1.5 },
      { threads: 64 },
      { inputFormats: [] },
      { inputFormats: ['mov,concat'] },
      { inputFormats: ['-i'] },
    ];
    for (const patch of bad) expect(() => buildClipArgs({ ...CLIP, ...patch })).toThrow(RangeError);
    expect(() => buildClipArgs({ ...CLIP, input: '/data/in\0.mov' })).toThrow(RangeError);
  });
});

describe('buildFrameArgs', () => {
  it('guards the input, caps threads, seeks, takes one frame through the box filter, strips metadata', () => {
    expect(buildFrameArgs({ input: '/a/in.mp4', output: '/a/p.jpg', atSec: 20, maxEdge: 720, quality: 3 })).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-filter_threads', '2',
      ...GUARD,
      '-threads', '2',
      '-ss', '20.000',
      '-i', '/a/in.mp4',
      '-map', '0:V:0',
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-frames:v', '1',
      '-vf', boxScaleFilter(720),
      '-q:v', '3',
      '-update', '1',
      '-fflags', '+bitexact', '-flags:v', '+bitexact',
      '/a/p.jpg',
    ]);
  });

  it('refuses bad paths, negative times and out-of-scale quality', () => {
    const ok = { input: '/a/in.mp4', output: '/a/p.jpg', atSec: 0, maxEdge: 720, quality: 3 };
    expect(() => buildFrameArgs({ ...ok, input: '-x' })).toThrow(RangeError);
    expect(() => buildFrameArgs({ ...ok, atSec: -0.1 })).toThrow(RangeError);
    expect(() => buildFrameArgs({ ...ok, quality: 1 })).toThrow(RangeError);
    expect(() => buildFrameArgs({ ...ok, output: ok.input })).toThrow(RangeError);
    expect(() => buildFrameArgs({ ...ok, threads: 0 })).toThrow(RangeError);
    expect(() => buildFrameArgs({ ...ok, inputFormats: ['concat', 'x y'] })).toThrow(RangeError);
  });
});

describe('inputGuardArgs / buildProbeArgs', () => {
  it('defaults to exactly the video containers the upload routes accept', () => {
    expect([...DEFAULT_VIDEO_INPUT_FORMATS]).toEqual(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm']);
    expect(inputGuardArgs()).toEqual(GUARD);
    for (const risky of ['concat', 'hls', 'dash', 'image2', 'sdp', 'rtp']) {
      expect(DEFAULT_VIDEO_INPUT_FORMATS).not.toContain(risky);
    }
  });

  it('refuses a list that could carry anything but plain demuxer names', () => {
    for (const bad of [[], [''], ['mov mp4'], ['mov,concat'], ['-y'], ['MOV'], [42 as unknown as string]]) {
      expect(() => inputGuardArgs(bad)).toThrow(RangeError);
    }
  });

  it('probes through the same guard, with the path last', () => {
    expect(buildProbeArgs('/a/in.mov')).toEqual([
      '-v', 'error', ...GUARD, '-print_format', 'json', '-show_format', '-show_streams', '/a/in.mov',
    ]);
    expect(() => buildProbeArgs('in.mov')).toThrow(RangeError);
    expect(() => buildProbeArgs('/a/\0.mov')).toThrow(RangeError);
  });
});

describe('sniffVideoContainer', () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

  it('accepts ISO-BMFF / QuickTime (ftyp in the first 12 bytes) and Matroska/WebM (EBML magic)', () => {
    expect(VIDEO_CONTAINER_SNIFF_BYTES).toBe(12);
    expect(sniffVideoContainer(bytes([0, 0, 0, 0x20], 'ftypisom'))).toBe('isobmff');
    expect(sniffVideoContainer(bytes([0, 0, 0, 0x14], 'ftypqt  '))).toBe('isobmff');
    expect(sniffVideoContainer(bytes([0, 0, 0, 0x08], 'wide', [0, 0, 0, 0x10]))).toBe('isobmff');
    expect(sniffVideoContainer(bytes([0, 0, 0, 0x08], 'free'))).toBe('isobmff');
    expect(sniffVideoContainer(bytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81]))).toBe('ebml');
  });

  it('refuses text containers ffmpeg would follow, other media and junk', () => {
    for (const head of [
      'ffconcat version 1.0\nfile x.mp4\n',
      '#EXTM3U\n#EXT-X-VERSION:3\n',
      '<?xml version="1.0"?><MPD',
      'v=0\no=- 0 0 IN IP4 127.0.0.1\n',
      'RIFF\0\0\0\0AVI LIST',
      'GIF89a',
    ]) {
      expect(sniffVideoContainer(bytes(head))).toBeNull();
    }
    expect(sniffVideoContainer(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(sniffVideoContainer(bytes([0, 0, 0, 0x04], 'moov'))).toBeNull(); // impossible box size
    expect(sniffVideoContainer(new Uint8Array(0))).toBeNull();
    expect(sniffVideoContainer(bytes([0x1a, 0x45]))).toBeNull();
    expect(sniffVideoContainer('ftyp' as unknown as Uint8Array)).toBeNull();
  });

  it('reads the head of a file and never throws', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aic-sniff-'));
    try {
      await fsp.writeFile(path.join(dir, 'a.mov'), Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(40)]));
      await fsp.writeFile(path.join(dir, 'b.mov'), 'ffconcat version 1.0\nfile a.mov\n');
      await fsp.writeFile(path.join(dir, 'empty.mov'), '');
      expect(await sniffVideoContainerFile(path.join(dir, 'a.mov'))).toBe('isobmff');
      expect(await sniffVideoContainerFile(path.join(dir, 'b.mov'))).toBeNull();
      expect(await sniffVideoContainerFile(path.join(dir, 'empty.mov'))).toBeNull();
      expect(await sniffVideoContainerFile(path.join(dir, 'missing.mov'))).toBeNull();
      expect(await sniffVideoContainerFile(dir)).toBeNull(); // a directory
      expect(await sniffVideoContainerFile('a.mov')).toBeNull(); // relative
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('scale filters / fps / seconds / tmp names', () => {
  it('fits a box without upscaling; the clip variant forces even sides with a ≥ 2 clamp', () => {
    expect(boxScaleFilter(720)).toBe("scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease");
    expect(evenBoxScaleFilter(640)).toBe(
      "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease,scale='max(2\\,trunc(iw/2)*2)':'max(2\\,trunc(ih/2)*2)'",
    );
  });

  it('keeps a slower source at its own rate, caps a faster one, and never goes below 1 fps', () => {
    expect(clipOutputFps(24, 30)).toBe(24);
    expect(clipOutputFps(29.97, 30)).toBe(29.97);
    expect(clipOutputFps(240, 30)).toBe(30);
    expect(clipOutputFps(null, 30)).toBe(30);
    expect(clipOutputFps(Number.NaN, 30)).toBe(30);
    expect(clipOutputFps(0, 30)).toBe(30);
    // A 0.5 fps slideshow used to pass straight through and fail buildClipArgs' fps ≥ 1 check.
    expect(clipOutputFps(0.5, 30)).toBe(1);
    expect(clipOutputFps(0.001, 30)).toBe(1);
    expect(() => buildClipArgs({ ...CLIP, fps: clipOutputFps(0.5, 30) })).not.toThrow();
  });

  it('formats seconds with fixed millisecond precision, never exponent notation', () => {
    expect(ffmpegSeconds(0)).toBe('0.000');
    expect(ffmpegSeconds(1e-7)).toBe('0.000');
    expect(ffmpegSeconds(12.3456)).toBe('12.346');
    expect(ffmpegSeconds(-4)).toBe('0.000');
  });

  it('names the tmp output `<output>.tmp.<ext>` (same container; what the card sweep recognises)', () => {
    expect(tmpOutputPath('/x/loop/a.mp4')).toBe('/x/loop/a.mp4.tmp.mp4');
    expect(tmpOutputPath('/x/poster/a.jpg')).toBe('/x/poster/a.jpg.tmp.jpg');
  });
});

describe('parseProbeOutput / parseFrameRate', () => {
  it('reads duration, display size, fps and audio from ffprobe JSON', () => {
    expect(
      parseProbeOutput({
        streams: [
          { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', disposition: { attached_pic: 0 } },
          { codec_type: 'audio' },
        ],
        format: { duration: '45.021000' },
      }),
    ).toEqual({ durationSec: 45.021, videoDurationSec: null, width: 1920, height: 1080, fps: 29.97, hasVideo: true, hasAudio: true });
  });

  it('swaps width/height for a quarter-turn rotation (display matrix or legacy rotate tag)', () => {
    const phone = (extra: Record<string, unknown>) =>
      parseProbeOutput({ streams: [{ codec_type: 'video', width: 1920, height: 1080, ...extra }], format: { duration: '3' } });
    expect(phone({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })).toMatchObject({ width: 1080, height: 1920 });
    expect(phone({ tags: { rotate: '270' } })).toMatchObject({ width: 1080, height: 1920 });
    expect(phone({ side_data_list: [{ rotation: 180 }] })).toMatchObject({ width: 1920, height: 1080 });
  });

  it('skips cover art, falls back to the stream duration, and refuses a file without any duration', () => {
    const r = parseProbeOutput({
      streams: [
        { codec_type: 'video', width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: 'video', width: 640, height: 360, r_frame_rate: '25/1', avg_frame_rate: '0/0', duration: '7.5' },
      ],
      format: {},
    });
    expect(r).toEqual({ durationSec: 7.5, videoDurationSec: 7.5, width: 640, height: 360, fps: 25, hasVideo: true, hasAudio: false });
    expect(parseProbeOutput({ streams: [{ codec_type: 'audio' }], format: { duration: '9' } })).toEqual({
      durationSec: 9,
      videoDurationSec: null,
      width: null,
      height: null,
      fps: null,
      hasVideo: false,
      hasAudio: true,
    });
    for (const bad of [null, 'x', {}, { streams: [], format: { duration: '0' } }, { format: { duration: 'N/A' } }]) {
      expect(parseProbeOutput(bad)).toBeNull();
    }
  });

  it("reports the VIDEO stream's own length beside the container's, so a video-only cut ignores an audio tail", () => {
    const tail = parseProbeOutput({
      streams: [
        { codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1', duration: '8.000000' },
        { codec_type: 'audio', duration: '40.000000' },
      ],
      format: { duration: '40.000000' },
    })!;
    expect(tail).toMatchObject({ durationSec: 40, videoDurationSec: 8 });
    expect(videoTimelineSec(tail)).toBe(8);
    // Matroska carries it as a DURATION tag instead of a stream field.
    const mkv = parseProbeOutput({
      streams: [{ codec_type: 'video', width: 320, height: 240, tags: { DURATION: '00:00:03.500000000' } }],
      format: { duration: '12.25' },
    })!;
    expect(mkv).toMatchObject({ durationSec: 12.25, videoDurationSec: 3.5 });
    // Never longer than the container; no stream figure ⇒ the container's.
    expect(parseProbeOutput({ streams: [{ codec_type: 'video', duration: '9.5' }], format: { duration: '9.4' } })!.videoDurationSec).toBe(9.4);
    const bare = parseProbeOutput({ streams: [{ codec_type: 'video' }], format: { duration: '6' } })!;
    expect(bare.videoDurationSec).toBeNull();
    expect(videoTimelineSec(bare)).toBe(6);
  });

  it('parses Matroska DURATION tags, refusing anything else', () => {
    expect(parseDurationTag('00:01:02.500000000')).toBe(62.5);
    expect(parseDurationTag('1:00:00')).toBe(3600);
    for (const bad of ['', '00:00:00.000', '12.5', '00:61:00', 'N/A', null, 5]) expect(parseDurationTag(bad)).toBeNull();
  });

  it('picks the frame rate: avg for a constant-rate file, r_frame_rate when avg is unusable or the stream is variable-rate', () => {
    expect(pickSourceFrameRate('30000/1001', '30000/1001')).toBe(29.97);
    expect(pickSourceFrameRate('30000/1001', '30/1')).toBe(29.97); // within 10 %: keep the precise average
    expect(pickSourceFrameRate('24/1', '24/1')).toBe(24);
    expect(pickSourceFrameRate('0/0', '25/1')).toBe(25);
    // A mostly static screen recording: the average collapses, the bursts still run at 30.
    expect(pickSourceFrameRate('3/5', '30/1')).toBe(30);
    expect(pickSourceFrameRate('12/1', '30/1')).toBe(30);
    // A real slideshow reports both below 1 — kept here, clamped by clipOutputFps.
    expect(pickSourceFrameRate('1/2', '1/2')).toBe(0.5);
    expect(clipOutputFps(pickSourceFrameRate('1/2', '1/2'), 30)).toBe(1);
    // A timebase-sized r (90000/1) is not a frame rate: fall back to the average.
    expect(pickSourceFrameRate('30/1', '90000/1')).toBe(30);
    expect(pickSourceFrameRate(undefined, undefined)).toBeNull();
    expect(
      parseProbeOutput({ streams: [{ codec_type: 'video', avg_frame_rate: '3/5', r_frame_rate: '30/1' }], format: { duration: '20' } })!.fps,
    ).toBe(30);
  });

  it('parses rational and plain frame rates, refusing 0/0 and garbage', () => {
    expect(parseFrameRate('24/1')).toBe(24);
    expect(parseFrameRate('60')).toBe(60);
    expect(parseFrameRate('0/0')).toBeNull();
    expect(parseFrameRate('1/0')).toBeNull();
    expect(parseFrameRate('abc')).toBeNull();
    expect(parseFrameRate(30)).toBeNull();
  });
});

describe('no ffmpeg on this box (test seam)', () => {
  afterAll(() => setMediaToolBinaries(null));

  it('reads a missing binary as unavailable everywhere, without throwing', async () => {
    setMediaToolBinaries({ ffmpeg: 'aic-no-such-ffmpeg-binary', ffprobe: 'aic-no-such-ffprobe-binary' });
    expect(await hasFfmpeg()).toBe(false);
    expect(await hasFfprobe()).toBe(false);
    expect(await runFfmpeg(['-version'], 5_000)).toBe(false);
    expect(await probeMediaFile('/definitely/not/here.mp4')).toBeNull();
    const out = path.join(os.tmpdir(), `aic-noffmpeg-${process.pid}.mp4`);
    expect(
      await renderClip({ ...CLIP, input: '/definitely/not/here.mp4', output: out, timeoutMs: 5_000, maxBytes: 1_000_000 }),
    ).toBe(false);
    expect(fs.existsSync(out) || fs.existsSync(tmpOutputPath(out))).toBe(false);
  });

  it('refuses a relative path before spawning anything', async () => {
    setMediaToolBinaries(null);
    expect(await probeMediaFile('relative.mp4')).toBeNull();
    expect(await probeMediaFile('-version')).toBeNull();
  });

  it('believes a FAILED availability check for a minute only, and a found binary for good', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aic-tools-'));
    const bin = path.join(dir, 'late-ffmpeg');
    setMediaToolBinaries({ ffmpeg: bin });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      expect(await hasFfmpeg()).toBe(false); // e.g. a spawn that failed under load
      await fsp.writeFile(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      vi.setSystemTime(1_000_000 + NEGATIVE_AVAILABILITY_TTL_MS - 1);
      expect(await hasFfmpeg()).toBe(false); // still inside the negative TTL: no re-spawn
      vi.setSystemTime(1_000_000 + NEGATIVE_AVAILABILITY_TTL_MS + 1);
      expect(await hasFfmpeg()).toBe(true); // re-checked, found
      await fsp.rm(bin);
      vi.setSystemTime(1_000_000 + 100 * NEGATIVE_AVAILABILITY_TTL_MS);
      expect(await hasFfmpeg()).toBe(true); // a positive answer is kept for the life of the process
    } finally {
      vi.useRealTimers();
      setMediaToolBinaries(null);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── Real renders (only where ffmpeg + ffprobe exist) ───────────────────────

const HAVE_TOOLS =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

describe.runIf(HAVE_TOOLS)('renderClip / renderFrame against real ffmpeg', { timeout: 60_000 }, () => {
  const dir = path.join(os.tmpdir(), `aic-video-clip-test-${process.pid}`);
  const source = path.join(dir, 'source.mp4');

  beforeAll(async () => {
    await fsp.mkdir(dir, { recursive: true });
    // 6 s, 24 fps, odd-sized 322×179 portrait-unfriendly frame, a sine track and
    // the kind of tags a phone writes — everything the renderer must drop.
    const r = spawnSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=322x179:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '6',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        '-metadata', 'title=secret-title',
        '-metadata', 'location=+37.7749-122.4194/',
        source,
      ],
      { stdio: 'ignore' },
    );
    expect(r.status).toBe(0);
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('cuts an exact, muted, metadata-free, even-sided clip at the source frame rate', async () => {
    const out = path.join(dir, 'clip.mp4');
    const ok = await renderClip({
      input: source,
      output: out,
      startSec: 1.5,
      endSec: 4,
      maxEdge: 720,
      fps: clipOutputFps(24, 30),
      crf: 30,
      maxrateKbps: 1000,
      mute: true,
      timeoutMs: 30_000,
      maxBytes: 10_000_000,
    });
    expect(ok).toBe(true);
    expect(fs.existsSync(tmpOutputPath(out))).toBe(false);

    const probe = await probeMediaFile(out);
    expect(probe).not.toBeNull();
    expect(probe!.hasAudio).toBe(false);
    expect(probe!.durationSec).toBeGreaterThan(2.4);
    expect(probe!.durationSec).toBeLessThan(2.6);
    expect(probe!.fps).toBe(24);
    expect(probe!.width! % 2).toBe(0);
    expect(probe!.height! % 2).toBe(0);

    const json = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', out], { encoding: 'utf8' }).stdout;
    const tags = (JSON.parse(json).format.tags ?? {}) as Record<string, string>;
    expect(Object.keys(tags).filter((k) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k))).toEqual([]);
    const bytes = await fsp.readFile(out);
    expect(bytes.includes(Buffer.from('secret-title'))).toBe(false);
    expect(bytes.includes(Buffer.from('37.7749'))).toBe(false);
    // faststart: the moov atom precedes the media data.
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
  });

  it('renders a poster frame and refuses a timestamp past the last frame', async () => {
    const poster = path.join(dir, 'poster.jpg');
    expect(await renderFrame({ input: source, output: poster, atSec: 2, maxEdge: 720, quality: 3, timeoutMs: 15_000, maxBytes: 5_000_000 })).toBe(true);
    const head = (await fsp.readFile(poster)).subarray(0, 3);
    expect([...head]).toEqual([0xff, 0xd8, 0xff]);

    const late = path.join(dir, 'late.jpg');
    expect(await renderFrame({ input: source, output: late, atSec: 60, maxEdge: 720, quality: 3, timeoutMs: 15_000, maxBytes: 5_000_000 })).toBe(false);
    expect(fs.existsSync(late) || fs.existsSync(tmpOutputPath(late))).toBe(false);
  });

  it('never promotes the frameless mp4 ffmpeg writes (exit 0) for a range past the end', async () => {
    const out = path.join(dir, 'past-end.mp4');
    const ok = await renderClip({ ...CLIP, input: source, output: out, startSec: 30, endSec: 32, timeoutMs: 30_000, maxBytes: 10_000_000 });
    expect(ok).toBe(false);
    expect(fs.existsSync(out) || fs.existsSync(tmpOutputPath(out))).toBe(false);
  });

  it('refuses the ffconcat trick on every input: a text list saved as .mov never reaches the file it names', async () => {
    // The review's live repro: an 86-byte concat list uploaded as video/quicktime.
    const list = path.join(dir, 'concat.mov');
    await fsp.writeFile(list, 'ffconcat version 1.0\nfile source.mp4\ninpoint 1\nduration 3\n');
    // Unguarded, ffprobe picks the concat demuxer from the bytes and reads source.mp4:
    const raw = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', list], { encoding: 'utf8' });
    expect(raw.status).toBe(0);
    expect(JSON.parse(raw.stdout).format).toMatchObject({ format_name: 'concat', duration: '3.000000' });
    // Guarded, nothing opens it — probe, clip and frame alike.
    const guarded = spawnSync('ffprobe', buildProbeArgs(list), { encoding: 'utf8' });
    expect(guarded.status).not.toBe(0);
    expect(guarded.stderr).toContain('Format not on whitelist');
    expect(await probeMediaFile(list)).toBeNull();
    const out = path.join(dir, 'from-concat.mp4');
    expect(await renderClip({ ...CLIP, input: list, output: out, startSec: 0, endSec: 2, timeoutMs: 30_000, maxBytes: 10_000_000 })).toBe(false);
    const still = path.join(dir, 'from-concat.jpg');
    expect(await renderFrame({ input: list, output: still, atSec: 1, maxEdge: 720, quality: 3, timeoutMs: 15_000, maxBytes: 5_000_000 })).toBe(false);
    for (const f of [out, still]) expect(fs.existsSync(f) || fs.existsSync(tmpOutputPath(f))).toBe(false);
    // And the upload-time sniff would never have stored it as a video.
    expect(await sniffVideoContainerFile(list)).toBeNull();
    expect(await sniffVideoContainerFile(source)).toBe('isobmff');
  });

  it('still opens every accepted container under the guard (mp4 above, Matroska here) and reads its stream length', async () => {
    const mkv = path.join(dir, 'source.mkv');
    const made = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mkv],
      { stdio: 'ignore' },
    );
    expect(made.status).toBe(0);
    expect(await sniffVideoContainerFile(mkv)).toBe('ebml');
    const probe = await probeMediaFile(mkv);
    expect(probe).toMatchObject({ hasVideo: true, fps: 25 });
    expect(probe!.videoDurationSec).toBeGreaterThan(1.9);
    expect(probe!.videoDurationSec).toBeLessThanOrEqual(probe!.durationSec);
    const out = path.join(dir, 'from-mkv.mp4');
    expect(await renderClip({ ...CLIP, input: mkv, output: out, startSec: 0.5, endSec: 1.5, fps: 25, timeoutMs: 30_000, maxBytes: 10_000_000 })).toBe(true);
  });

  it('cuts a 0.5 fps slideshow at 1 fps instead of failing', async () => {
    const slow = path.join(dir, 'slideshow.mp4');
    const made = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=1/2', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', slow],
      { stdio: 'ignore' },
    );
    expect(made.status).toBe(0);
    const probe = await probeMediaFile(slow);
    expect(probe!.fps).toBe(0.5);
    const out = path.join(dir, 'slideshow-clip.mp4');
    const fps = clipOutputFps(probe!.fps, 30);
    expect(fps).toBe(1);
    expect(await renderClip({ ...CLIP, input: slow, output: out, startSec: 2, endSec: 12, fps, timeoutMs: 30_000, maxBytes: 10_000_000 })).toBe(true);
    const clip = await probeMediaFile(out);
    expect(clip!.hasVideo).toBe(true);
    expect(clip!.durationSec).toBeGreaterThan(9);
  });

  it('measures the picture, not an audio track that outlasts it', async () => {
    const tail = path.join(dir, 'audio-tail.mp4');
    const made = spawnSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-t', '3', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
        '-t', '10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        tail,
      ],
      { stdio: 'ignore' },
    );
    expect(made.status).toBe(0);
    const probe = (await probeMediaFile(tail))!;
    expect(probe.durationSec).toBeGreaterThan(9.5);
    expect(probe.videoDurationSec).toBeGreaterThan(2.9);
    expect(probe.videoDurationSec).toBeLessThan(3.2);
    expect(videoTimelineSec(probe)).toBe(probe.videoDurationSec);
    // Past the picture there is nothing to cut — exactly the range the container length used to allow.
    const lost = path.join(dir, 'audio-tail-late.mp4');
    expect(await renderClip({ ...CLIP, input: tail, output: lost, startSec: 5, endSec: 9, timeoutMs: 30_000, maxBytes: 10_000_000 })).toBe(false);
  });

  it('drops an output over the byte cap and a source that is not a video', async () => {
    const big = path.join(dir, 'capped.mp4');
    expect(await renderClip({ ...CLIP, input: source, output: big, startSec: 0, endSec: 3, timeoutMs: 30_000, maxBytes: 100 })).toBe(false);
    expect(fs.existsSync(big) || fs.existsSync(tmpOutputPath(big))).toBe(false);

    const junk = path.join(dir, 'junk.mp4');
    await fsp.writeFile(junk, 'not a video at all');
    const out = path.join(dir, 'from-junk.mp4');
    expect(await renderClip({ ...CLIP, input: junk, output: out, startSec: 0, endSec: 1, timeoutMs: 30_000, maxBytes: 10_000_000 })).toBe(false);
    expect(await probeMediaFile(junk)).toBeNull();
  });
});
