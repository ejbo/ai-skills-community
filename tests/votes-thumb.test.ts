// 作品卡片缩略图 —— lib/votes/thumb.ts（纯函数）+ lib/votes/storage.ts#ensureVoteThumb。
// 钉住的每一条都对应一个真实的坏结果：
//   - 竖拍手机照片按 EXIF 转正（ffmpeg 新版自动转、老版不转，所以必须自己转）；
//   - 伪装成 .jpg 的 HLS 播放列表不能让 ffmpeg 跟着去开别的资源；
//   - 透明 PNG 不能被压成黑底 JPEG；
//   - 压不小的图记 skip，不为同一个结论反复起 ffmpeg；
//   - 删原图要连缩略图一起删（派生文件不在任何表里）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VOTE_THUMB_EDGE,
  jpegOrientation,
  orientationFilters,
  voteThumbFfmpegArgs,
  voteThumbKeyFor,
  voteThumbSkipKeyFor,
} from '@/lib/votes/thumb';
import { voteThumbUrl } from '@/lib/votes/shared';

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** Minimal APP1 EXIF segment carrying Orientation = o, in either byte order. */
function exifSegment(o: number, littleEndian: boolean): Buffer {
  const tiff = Buffer.alloc(26);
  const w16 = (v: number, at: number) => (littleEndian ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const w32 = (v: number, at: number) => (littleEndian ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  tiff.write(littleEndian ? 'II' : 'MM', 0, 'ascii');
  w16(42, 2);
  w32(8, 4);
  w16(1, 8); // one IFD entry
  w16(0x0112, 10); // Orientation
  w16(3, 12); // SHORT
  w32(1, 14); // count
  w16(o, 18); // value (first two bytes of the value field)
  w32(0, 22); // next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const SOS = Buffer.from([0xff, 0xda, 0x00, 0x02]);

describe('voteThumbKeyFor', () => {
  it('derives a thumb key per still kind; JPEG stays JPEG, PNG/WebP become PNG (alpha)', () => {
    expect(voteThumbKeyFor('image/abc_D-1.jpg')).toBe(`thumb/image-abc_D-1_s${VOTE_THUMB_EDGE}.jpg`);
    expect(voteThumbKeyFor('poster/abc.jpg')).toBe(`thumb/poster-abc_s${VOTE_THUMB_EDGE}.jpg`);
    expect(voteThumbKeyFor('cover/abc.png')).toBe(`thumb/cover-abc_s${VOTE_THUMB_EDGE}.png`);
    expect(voteThumbKeyFor('image/abc.webp')).toBe(`thumb/image-abc_s${VOTE_THUMB_EDGE}.png`);
  });

  it('refuses gif (animation), avif, videos, previews, thumbs and anything not key-shaped', () => {
    for (const key of [
      'image/abc.gif',
      'image/abc.avif',
      'video/abc.mp4',
      'preview/abc.mp4',
      'thumb/image-abc_s640.jpg',
      'image/../secret.jpg',
      'image/a/b.jpg',
      '/api/votes/media/image/abc.jpg',
    ]) {
      expect(voteThumbKeyFor(key)).toBeNull();
    }
  });

  it('skip marker sits next to the thumb', () => {
    expect(voteThumbSkipKeyFor('thumb/image-abc_s640.jpg')).toBe('thumb/image-abc_s640.skip');
    expect(voteThumbSkipKeyFor('thumb/cover-abc_s640.png')).toBe('thumb/cover-abc_s640.skip');
  });
});

describe('voteThumbUrl', () => {
  it('asks for the thumb only on stored still-image URLs', () => {
    expect(voteThumbUrl('/api/votes/media/image/abc.jpg')).toBe('/api/votes/media/image/abc.jpg?thumb=1');
    expect(voteThumbUrl('/api/votes/media/poster/abc.jpg')).toBe('/api/votes/media/poster/abc.jpg?thumb=1');
    expect(voteThumbUrl('/api/votes/media/cover/abc.png')).toBe('/api/votes/media/cover/abc.png?thumb=1');
  });

  it('passes everything else through unchanged', () => {
    expect(voteThumbUrl('/api/votes/media/video/abc.mp4')).toBe('/api/votes/media/video/abc.mp4');
    expect(voteThumbUrl('/api/votes/media/image/abc.gif')).toBe('/api/votes/media/image/abc.gif');
    expect(voteThumbUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(voteThumbUrl('/api/votes/media/image/abc.jpg?thumb=1')).toBe('/api/votes/media/image/abc.jpg?thumb=1');
    expect(voteThumbUrl(null)).toBeNull();
    expect(voteThumbUrl(undefined)).toBeUndefined();
    expect(voteThumbUrl('')).toBe('');
  });
});

describe('jpegOrientation', () => {
  it('reads Orientation in both byte orders', () => {
    for (const le of [true, false]) {
      for (let o = 1; o <= 8; o++) {
        expect(jpegOrientation(Buffer.concat([SOI, exifSegment(o, le), SOS]))).toBe(o);
      }
    }
  });

  it('skips JFIF and a non-EXIF APP1 (XMP) to reach the EXIF segment', () => {
    const jfif = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'));
    const xmp = segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x/>', 'binary'));
    expect(jpegOrientation(Buffer.concat([SOI, jfif, xmp, exifSegment(6, false), SOS]))).toBe(6);
  });

  it('falls back to 1 on anything it cannot trust', () => {
    expect(jpegOrientation(Buffer.alloc(0))).toBe(1);
    expect(jpegOrientation(Buffer.from('\x89PNG\r\n', 'binary'))).toBe(1); // not a JPEG
    expect(jpegOrientation(Buffer.concat([SOI, SOS]))).toBe(1); // no EXIF before the scan
    expect(jpegOrientation(Buffer.concat([SOI, exifSegment(9, true), SOS]))).toBe(1); // out of range
    expect(jpegOrientation(Buffer.concat([SOI, exifSegment(6, true)]).subarray(0, 20))).toBe(1); // truncated
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0x00]))).toBe(1); // bogus length
  });
});

describe('voteThumbFfmpegArgs', () => {
  it('guards the input, disables autorotate BEFORE -i, then rotates explicitly and scales', () => {
    const args = voteThumbFfmpegArgs('/m/image/a.jpg', '/m/thumb/a.jpg.tmp.jpg', 6);
    const i = args.indexOf('-i');
    expect(args.slice(0, i)).toEqual([
      '-nostdin', '-v', 'error',
      '-format_whitelist', 'image2,jpeg_pipe,png_pipe,webp_pipe', '-protocol_whitelist', 'file',
      '-noautorotate',
    ]);
    expect(args[i + 1]).toBe('/m/image/a.jpg');
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^transpose=1,scale=/);
    expect(args).toContain('-q:v');
    expect(args.at(-1)).toBe('/m/thumb/a.jpg.tmp.jpg');
  });

  it('PNG output carries no JPEG quality flag; orientation 1 adds no rotation', () => {
    const args = voteThumbFfmpegArgs('/m/image/a.png', '/m/thumb/a.png.tmp.png', 1);
    expect(args).not.toContain('-q:v');
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^scale=/);
  });

  it('maps every EXIF orientation to the transform that displays it upright', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((o) => orientationFilters(o).join(','))).toEqual([
      '', 'hflip', 'hflip,vflip', 'vflip', 'transpose=0', 'transpose=1', 'transpose=3', 'transpose=2',
    ]);
    expect(orientationFilters(0)).toEqual([]);
  });
});

describe.skipIf(!HAS_FFMPEG)('ensureVoteThumb (real ffmpeg, temp storage root)', () => {
  let root: string;
  let storage: typeof import('@/lib/votes/storage');
  const media = (key: string) => path.join(root, 'vote-media', key);
  const ff = (...args: string[]) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'ignore' }).status;
  const dims = (file: string) =>
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {
      encoding: 'utf8',
    }).stdout.trim();

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vote-thumb-'));
    process.env.LOCAL_STORAGE_DIR = root; // MEDIA_ROOT is read at import
    storage = await import('@/lib/votes/storage');
    fs.mkdirSync(media('image'), { recursive: true });
    // A noisy 2400x1800 JPEG (well over the 512 KB floor), then the same pixels
    // tagged "rotate 90° CW" the way a phone stores a portrait shot.
    ff('-f', 'lavfi', '-i', 'testsrc2=size=2400x1800', '-vf', 'noise=alls=40:allf=u', '-frames:v', '1', '-q:v', '2', media('image/land.jpg'));
    const jpg = fs.readFileSync(media('image/land.jpg'));
    fs.writeFileSync(media('image/rot6.jpg'), Buffer.concat([jpg.subarray(0, 2), exifSegment(6, false), jpg.subarray(2)]));
    // An HLS playlist pretending to be a photo (padded past the size floor).
    fs.writeFileSync(
      media('image/evil.jpg'),
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile://${media('image/land.jpg')}\n#EXT-X-ENDLIST\n`.padEnd(600 * 1024, '#'),
    );
  }, 30_000);

  afterAll(() => {
    delete process.env.LOCAL_STORAGE_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const size = (key: string) => fs.statSync(media(key)).size;

  it('small originals are served as-is, permanently', async () => {
    fs.writeFileSync(media('image/small.jpg'), Buffer.alloc(10_000));
    expect(await storage.ensureVoteThumb('image/small.jpg', size('image/small.jpg'))).toEqual({ kind: 'original', final: true });
    expect(fs.existsSync(media('thumb'))).toBe(false);
  });

  it('makes a short-edge-640 thumb once, then serves the cached file', async () => {
    const first = await storage.ensureVoteThumb('image/land.jpg', size('image/land.jpg'));
    expect(first).toMatchObject({ kind: 'thumb', key: 'thumb/image-land_s640.jpg' });
    expect(dims(media('thumb/image-land_s640.jpg'))).toBe('853,640');
    const mtime = fs.statSync(media('thumb/image-land_s640.jpg')).mtimeMs;
    expect(await storage.ensureVoteThumb('image/land.jpg', size('image/land.jpg'))).toMatchObject({ kind: 'thumb' });
    expect(fs.statSync(media('thumb/image-land_s640.jpg')).mtimeMs).toBe(mtime);
    // no tmp leftovers
    expect(fs.readdirSync(media('thumb')).filter((f) => f.includes('.tmp.'))).toEqual([]);
  }, 30_000);

  it('turns an EXIF-rotated portrait upright (the browser shows the original upright too)', async () => {
    const r = await storage.ensureVoteThumb('image/rot6.jpg', size('image/rot6.jpg'));
    expect(r).toMatchObject({ kind: 'thumb' });
    expect(dims(media('thumb/image-rot6_s640.jpg'))).toBe('640,853');
  }, 30_000);

  it('a disguised playlist never opens anything: skip marker, original (which no browser can render either)', async () => {
    expect(await storage.ensureVoteThumb('image/evil.jpg', size('image/evil.jpg'))).toEqual({ kind: 'original', final: true });
    expect(fs.existsSync(media('thumb/image-evil_s640.skip'))).toBe(true);
    expect(fs.existsSync(media('thumb/image-evil_s640.jpg'))).toBe(false);
    // and the marker short-circuits the next request (no second ffmpeg)
    expect(await storage.ensureVoteThumb('image/evil.jpg', size('image/evil.jpg'))).toEqual({ kind: 'original', final: true });
  }, 30_000);

  it('concurrent requests for the same image both get the one finished thumb (shared tmp path, no clobber)', async () => {
    fs.copyFileSync(media('image/land.jpg'), media('image/twin.jpg'));
    const [a, b] = await Promise.all([
      storage.ensureVoteThumb('image/twin.jpg', size('image/twin.jpg')),
      storage.ensureVoteThumb('image/twin.jpg', size('image/twin.jpg')),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ kind: 'thumb' });
  }, 30_000);

  it('deleting the original takes its thumb and skip marker with it', async () => {
    await storage.deleteVoteMediaFile('image/land.jpg');
    await storage.deleteVoteMediaFile('image/evil.jpg');
    expect(fs.existsSync(media('image/land.jpg'))).toBe(false);
    expect(fs.existsSync(media('thumb/image-land_s640.jpg'))).toBe(false);
    expect(fs.existsSync(media('thumb/image-evil_s640.skip'))).toBe(false);
    expect(fs.existsSync(media('thumb/image-rot6_s640.jpg'))).toBe(true); // others untouched
  });
});
