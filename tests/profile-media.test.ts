// 名片媒体 storage — the pure half of lib/profile/card-media-storage.ts.
//
// Pinned because each one guards a real failure: the suffix Range form the house
// routes parse wrong (Safari asks for `bytes=-N` tails), a key walking out of
// `profile-card/`, a content type that makes a video download instead of play,
// a declared type that could smuggle an svg/html extension onto disk, a video
// original becoming servable, a key attachable by someone other than its
// uploader, EXIF GPS published with a card photo (AVIF included — refused, since
// its metadata cannot be stripped), an unread body pinning a file descriptor, a
// write error that hung the upload forever, and abandoned uploads filling the
// disk (the sweep must reclaim only the caller's own, stale, finished-or-tmp files).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TMP_STORAGE = vi.hoisted(() => {
  // Before any import: image-storage resolves the uploads root from this at
  // load, so the disk tests below never touch the dev box's real uploads.
  process.env.LOCAL_STORAGE_DIR = `/tmp/aic-profile-media-test-${process.pid}`;
  return `/tmp/aic-profile-media-test-${process.pid}`;
});
vi.mock('@/lib/env', () => ({ env: { AUTH_SECRET: 'test-secret-test-secret-0123456789' } }));

import {
  PROFILE_MEDIA_DIR,
  PROFILE_MEDIA_OWNER_TAG_LEN,
  PROFILE_UPLOAD_IMAGE_TYPES,
  PROFILE_UPLOAD_ORPHAN_AGE_MS,
  PROFILE_UPLOAD_VIDEO_TYPES,
  classifyOwnProfileMediaEntry,
  deleteOwnProfileMediaEntries,
  isProfileMediaKeyOwnedBy,
  isProfileMediaKeyTaggedFor,
  isProfileUploadKind,
  listStaleOwnProfileMedia,
  newProfileMediaKey,
  openProfileMediaBody,
  orientationOnlyTiff,
  ownerTagFor,
  parseByteRange,
  profileMediaAbsPath,
  profileMediaContentType,
  profileMediaExtFor,
  profileMediaKeyTag,
  profileMediaOwnerTag,
  profileMediaServeTarget,
  profileMediaXAccelUri,
  profileUploadMaxBytes,
  readTiffOrientation,
  saveProfileMediaStream,
  sniffImageFormat,
  stripImageMetadata,
} from '@/lib/profile/card-media-storage';
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_POSTER_MAX_BYTES,
  PROFILE_VIDEO_MAX_BYTES,
  isValidProfileMediaKey,
  profileMediaUrl,
} from '@/lib/profile/shared';

describe('parseByteRange', () => {
  const size = 1000;

  it('ignores a missing / malformed / multi-range header (full 200)', () => {
    for (const h of [null, undefined, '', 'bytes', 'bytes=', 'bytes=-', 'items=0-10', 'bytes=0-10,20-30', 'bytes=a-b']) {
      expect(parseByteRange(h, size)).toEqual({ type: 'none' });
    }
  });

  it('serves a closed range and clamps its end to the file', () => {
    expect(parseByteRange('bytes=0-99', size)).toEqual({ type: 'range', start: 0, end: 99 });
    expect(parseByteRange('bytes=900-5000', size)).toEqual({ type: 'range', start: 900, end: 999 });
    expect(parseByteRange('bytes=999-999', size)).toEqual({ type: 'range', start: 999, end: 999 });
  });

  it('serves an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=0-', size)).toEqual({ type: 'range', start: 0, end: 999 });
    expect(parseByteRange('bytes=500-', size)).toEqual({ type: 'range', start: 500, end: 999 });
  });

  it('reads bytes=-N as the LAST N bytes, not 0..N', () => {
    expect(parseByteRange('bytes=-500', size)).toEqual({ type: 'range', start: 500, end: 999 });
    expect(parseByteRange('bytes=-1', size)).toEqual({ type: 'range', start: 999, end: 999 });
    // A suffix longer than the file is the whole file.
    expect(parseByteRange('bytes=-5000', size)).toEqual({ type: 'range', start: 0, end: 999 });
  });

  it('is unsatisfiable past the end, and for a zero-length suffix', () => {
    expect(parseByteRange('bytes=1000-', size)).toEqual({ type: 'unsatisfiable' });
    expect(parseByteRange('bytes=1000-2000', size)).toEqual({ type: 'unsatisfiable' });
    expect(parseByteRange('bytes=-0', size)).toEqual({ type: 'unsatisfiable' });
  });

  it('ignores an inverted range rather than 416-ing it (RFC 9110: invalid ⇒ ignore)', () => {
    expect(parseByteRange('bytes=500-100', size)).toEqual({ type: 'none' });
  });

  it('tolerates case and surrounding whitespace', () => {
    expect(parseByteRange('  Bytes=10-19 ', size)).toEqual({ type: 'range', start: 10, end: 19 });
  });

  it('never ranges an empty or nonsensical size', () => {
    expect(parseByteRange('bytes=0-10', 0)).toEqual({ type: 'none' });
    expect(parseByteRange('bytes=0-10', Number.NaN)).toEqual({ type: 'none' });
  });
});

describe('profileMediaContentType', () => {
  it('labels images and videos so browsers render/play them inline', () => {
    expect(profileMediaContentType('image/abcdefgh.jpg')).toBe('image/jpeg');
    expect(profileMediaContentType('image/abcdefgh.png')).toBe('image/png');
    expect(profileMediaContentType('image/abcdefgh.webp')).toBe('image/webp');
    expect(profileMediaContentType('image/abcdefgh.avif')).toBe('image/avif');
    expect(profileMediaContentType('image/abcdefgh.gif')).toBe('image/gif');
    expect(profileMediaContentType('poster/abcdefgh.jpg')).toBe('image/jpeg');
    expect(profileMediaContentType('video/abcdefgh.mp4')).toBe('video/mp4');
    expect(profileMediaContentType('video/abcdefgh.webm')).toBe('video/webm');
    expect(profileMediaContentType('video/abcdefgh.mov')).toBe('video/quicktime');
    expect(profileMediaContentType('loop/abcdefgh.mp4')).toBe('video/mp4');
  });

  it('falls back to octet-stream for anything else (served with nosniff)', () => {
    expect(profileMediaContentType('image/abcdefgh.svg')).toBe('application/octet-stream');
    expect(profileMediaContentType('noext')).toBe('application/octet-stream');
  });
});

describe('profileMediaAbsPath', () => {
  const root = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './storage', 'uploads', PROFILE_MEDIA_DIR);

  it('maps a valid key under uploads/profile-card/', () => {
    expect(profileMediaAbsPath('image/V1StGXR8_Z5jdHi6B-myT.png')).toBe(
      path.join(root, 'image', 'V1StGXR8_Z5jdHi6B-myT.png'),
    );
    expect(profileMediaAbsPath('loop/V1StGXR8_Z5jdHi6B-myT.mp4')).toBe(path.join(root, 'loop', 'V1StGXR8_Z5jdHi6B-myT.mp4'));
  });

  it('refuses anything that is not a card media key — other namespaces and traversal included', () => {
    for (const key of [
      '../images/V1StGXR8_Z5jdHi6B-myT.png',
      'images/V1StGXR8_Z5jdHi6B-myT.png',
      'stickers/V1StGXR8_Z5jdHi6B-myT.gif',
      'image/../../etc/passwd',
      'image/short.png',
      'image/V1StGXR8_Z5jdHi6B-myT.svg',
      'video/V1StGXR8_Z5jdHi6B-myT.png',
      'loop/V1StGXR8_Z5jdHi6B-myT.webm',
      '',
    ]) {
      expect(profileMediaAbsPath(key)).toBeNull();
    }
  });

  it('builds the nginx handoff URI inside the existing /_uploads/ location', () => {
    expect(profileMediaXAccelUri('video/V1StGXR8_Z5jdHi6B-myT.mp4')).toBe(
      '/_uploads/profile-card/video/V1StGXR8_Z5jdHi6B-myT.mp4',
    );
  });
});

describe('upload kinds, types and keys', () => {
  it('only lets a client upload image / video / poster (loop is server-generated)', () => {
    expect(isProfileUploadKind('image')).toBe(true);
    expect(isProfileUploadKind('video')).toBe(true);
    expect(isProfileUploadKind('poster')).toBe(true);
    expect(isProfileUploadKind('loop')).toBe(false);
    expect(isProfileUploadKind('cover')).toBe(false);
    expect(isProfileUploadKind(null)).toBe(false);
  });

  it('derives the extension from the declared type per kind', () => {
    expect(profileMediaExtFor('image', 'image/jpeg')).toBe('jpg');
    expect(profileMediaExtFor('image', 'image/PNG; charset=binary')).toBe('png');
    expect(profileMediaExtFor('poster', 'image/webp')).toBe('webp');
    expect(profileMediaExtFor('video', 'video/mp4')).toBe('mp4');
    expect(profileMediaExtFor('video', 'video/quicktime')).toBe('mov');
  });

  it('refuses a type from the wrong family and anything off the allowlist', () => {
    // AVIF: its EXIF/XMP cannot be stripped server-side, so it is off the list —
    // by declared type and by filename alike.
    expect(profileMediaExtFor('image', 'image/avif')).toBeNull();
    expect(profileMediaExtFor('poster', 'image/avif')).toBeNull();
    expect(profileMediaExtFor('image', '', 'photo.avif')).toBeNull();
    expect(profileMediaExtFor('image', 'video/mp4')).toBeNull();
    expect(profileMediaExtFor('video', 'image/png')).toBeNull();
    expect(profileMediaExtFor('image', 'image/svg+xml', 'a.svg')).toBeNull();
    expect(profileMediaExtFor('image', 'text/html', 'a.png')).toBeNull();
  });

  it('lets the filename decide ONLY for a missing/generic type, and only from the same closed set', () => {
    expect(profileMediaExtFor('video', '', 'clip.WEBM')).toBe('webm');
    expect(profileMediaExtFor('video', 'application/octet-stream', 'clip.m4v')).toBe('mp4');
    expect(profileMediaExtFor('image', '', 'photo.jpeg')).toBe('jpg');
    expect(profileMediaExtFor('image', '', 'page.html')).toBeNull();
    expect(profileMediaExtFor('video', '', 'photo.png')).toBeNull();
    expect(profileMediaExtFor('image', '', '')).toBeNull();
  });

  it('mints keys the shared contract accepts, and URLs the public route serves', () => {
    const tag = profileMediaOwnerTag('user-1', 'secret-secret-secret');
    for (const [kind, ext] of [
      ['image', 'png'],
      ['video', 'webm'],
      ['poster', 'jpg'],
      ['loop', 'mp4'],
    ] as const) {
      const key = newProfileMediaKey(kind, ext, tag);
      expect(isValidProfileMediaKey(key, kind)).toBe(true);
      expect(profileMediaAbsPath(key)).not.toBeNull();
      expect(profileMediaUrl(key)).toBe(`/api/profile/media/${key}`);
    }
  });

  it('advertises exactly the types it accepts', () => {
    expect([...PROFILE_UPLOAD_IMAGE_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    expect([...PROFILE_UPLOAD_VIDEO_TYPES]).toEqual(['video/mp4', 'video/webm', 'video/quicktime']);
    for (const t of PROFILE_UPLOAD_IMAGE_TYPES) {
      expect(profileMediaExtFor('image', t)).not.toBeNull();
      expect(profileMediaExtFor('poster', t)).not.toBeNull();
    }
    for (const t of PROFILE_UPLOAD_VIDEO_TYPES) expect(profileMediaExtFor('video', t)).not.toBeNull();
  });

  it('caps each kind by its own product limit', () => {
    expect(profileUploadMaxBytes('image')).toBe(PROFILE_IMAGE_MAX_BYTES);
    expect(profileUploadMaxBytes('poster')).toBe(PROFILE_POSTER_MAX_BYTES);
    expect(profileUploadMaxBytes('video')).toBe(PROFILE_VIDEO_MAX_BYTES);
  });
});

// ─── Owner tag ───────────────────────────────────────────────────────────────

describe('owner tag (key ↔ uploader)', () => {
  const SECRET = 'secret-secret-secret';

  it('is a deterministic per-user, per-secret base64url prefix', () => {
    const a = profileMediaOwnerTag('user-a', SECRET);
    expect(a).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(a).toHaveLength(PROFILE_MEDIA_OWNER_TAG_LEN);
    expect(profileMediaOwnerTag('user-a', SECRET)).toBe(a);
    expect(profileMediaOwnerTag('user-b', SECRET)).not.toBe(a);
    expect(profileMediaOwnerTag('user-a', `${SECRET}-rotated`)).not.toBe(a);
  });

  it('rides in the key id and is read back exactly', () => {
    const tag = profileMediaOwnerTag('user-a', SECRET);
    const key = newProfileMediaKey('image', 'jpg', tag);
    expect(key).toMatch(new RegExp(`^image/${tag.replace(/[-]/g, '\\-')}-[A-Za-z0-9_-]{21}\\.jpg$`));
    expect(profileMediaKeyTag(key)).toBe(tag);
    expect(isProfileMediaKeyTaggedFor(key, tag)).toBe(true);
    expect(isProfileMediaKeyTaggedFor(key, profileMediaOwnerTag('user-b', SECRET))).toBe(false);
  });

  it('never matches a legacy untagged key, a malformed key or a malformed tag', () => {
    const tag = profileMediaOwnerTag('user-a', SECRET);
    expect(profileMediaKeyTag('image/V1StGXR8_Z5jdHi6B-myT.jpg')).toBeNull();
    expect(isProfileMediaKeyTaggedFor('image/V1StGXR8_Z5jdHi6B-myT.jpg', tag)).toBe(false);
    expect(isProfileMediaKeyTaggedFor(`image/${tag}-x.svg`, tag)).toBe(false);
    expect(isProfileMediaKeyTaggedFor(null, tag)).toBe(false);
    expect(isProfileMediaKeyTaggedFor(newProfileMediaKey('image', 'jpg', tag), 'ü'.repeat(10))).toBe(false);
    expect(() => newProfileMediaKey('image', 'jpg', 'short')).toThrow('invalid_owner_tag');
    expect(() => newProfileMediaKey('image', 'jpg', '../../etc/p')).toThrow('invalid_owner_tag');
  });

  it('uses AUTH_SECRET for the server-side helpers', () => {
    const key = newProfileMediaKey('poster', 'jpg', ownerTagFor('user-a'));
    expect(isProfileMediaKeyOwnedBy(key, 'user-a')).toBe(true);
    expect(isProfileMediaKeyOwnedBy(key, 'user-b')).toBe(false);
    expect(ownerTagFor('user-a')).toBe(profileMediaOwnerTag('user-a', 'test-secret-test-secret-0123456789'));
  });
});

describe('profileMediaServeTarget', () => {
  it('maps photos, posters and loops to the column that must reference them', () => {
    expect(profileMediaServeTarget('image/V1StGXR8_Z5jdHi6B-myT.jpg')).toEqual({ column: 'cardMediaKey', kind: 'image' });
    expect(profileMediaServeTarget('poster/V1StGXR8_Z5jdHi6B-myT.jpg')).toEqual({ column: 'cardPosterKey', kind: 'video' });
    expect(profileMediaServeTarget('loop/V1StGXR8_Z5jdHi6B-myT.mp4')).toEqual({ column: 'cardLoopKey', kind: 'video' });
  });

  it('never serves a video original, nor anything off-shape', () => {
    for (const key of [
      'video/V1StGXR8_Z5jdHi6B-myT.mp4',
      'video/V1StGXR8_Z5jdHi6B-myT.mov',
      'video/V1StGXR8_Z5jdHi6B-myT.webm',
      'images/V1StGXR8_Z5jdHi6B-myT.png',
      'image/../video/V1StGXR8_Z5jdHi6B-myT.mp4',
      '',
      null,
    ]) {
      expect(profileMediaServeTarget(key)).toBeNull();
    }
  });
});

// ─── Image metadata ──────────────────────────────────────────────────────────

const bytes = (...parts: (number[] | Uint8Array | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const contains = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, 'latin1'));

/** Little-endian TIFF: IFD0 = Orientation + a GPS IFD pointer, GPS IFD = GPSLatitudeRef "N" + a marker string. */
function exifTiff(orientation: number): Buffer {
  const b = Buffer.alloc(64);
  b.write('II', 0, 'latin1');
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(2, 8); // two entries
  b.writeUInt16LE(0x0112, 10); // Orientation SHORT 1
  b.writeUInt16LE(3, 12);
  b.writeUInt32LE(1, 14);
  b.writeUInt16LE(orientation, 18);
  b.writeUInt16LE(0x8825, 22); // GPSInfo LONG → 38
  b.writeUInt16LE(4, 24);
  b.writeUInt32LE(1, 26);
  b.writeUInt32LE(38, 30);
  b.writeUInt32LE(0, 34); // next IFD
  b.writeUInt16LE(1, 38); // GPS IFD: one entry
  b.writeUInt16LE(0x0001, 40); // GPSLatitudeRef ASCII "N"
  b.writeUInt16LE(2, 42);
  b.writeUInt32LE(2, 44);
  b.write('N\x00', 48, 'latin1');
  b.writeUInt32LE(0, 52);
  b.write('GPSDATA', 56, 'latin1');
  return b.subarray(0, 63);
}

describe('readTiffOrientation / orientationOnlyTiff', () => {
  it('reads IFD0 Orientation in either byte order and round-trips the minimal TIFF', () => {
    expect(readTiffOrientation(exifTiff(6))).toBe(6);
    for (const o of [1, 3, 6, 8]) expect(readTiffOrientation(orientationOnlyTiff(o))).toBe(o);
    expect(orientationOnlyTiff(6)).toHaveLength(26);
  });

  it('is null for garbage, truncation and out-of-range values', () => {
    expect(readTiffOrientation(new Uint8Array(4))).toBeNull();
    expect(readTiffOrientation(bytes('XX', [42, 0, 8, 0, 0, 0]))).toBeNull();
    expect(readTiffOrientation(exifTiff(6).subarray(0, 12))).toBeNull();
    expect(readTiffOrientation(exifTiff(9))).toBeNull();
  });
});

describe('stripImageMetadata — JPEG', () => {
  const seg = (marker: number, payload: Uint8Array | string) => {
    const p = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : Buffer.from(payload);
    return bytes([0xff, marker, ...be16(p.length + 2)], p);
  };
  const entropy = bytes([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]); // stuffed FF + RST0
  const jpeg = bytes(
    [0xff, 0xd8],
    seg(0xe0, 'JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00'),
    seg(0xe1, bytes('Exif\x00\x00', exifTiff(6))),
    seg(0xe1, 'http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>GPSXMP</x:xmpmeta>'),
    seg(0xe2, 'ICC_PROFILE\x00\x01\x01PROFILEBYTES'),
    seg(0xed, 'Photoshop 3.0\x008BIM IPTC-CITY'),
    seg(0xfe, 'a COM segment'),
    seg(0xdb, bytes([0, ...new Array(64).fill(1)])),
    seg(0xc0, bytes([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    seg(0xc4, bytes([0, 1, ...new Array(16).fill(0)])),
    seg(0xda, bytes([1, 1, 0, 0, 63, 0])),
    entropy,
    [0xff, 0xd9],
    'MPF-secondary Exif GPSDATA tail',
  );

  it('drops EXIF/XMP/IPTC/COM and everything after EOI, keeps JFIF/ICC/tables/scan, and re-adds only the orientation', () => {
    const r = stripImageMetadata(jpeg);
    expect(r).toMatchObject({ ok: true, format: 'jpeg', changed: true });
    if (!r.ok) return;
    const out = Buffer.from(r.bytes);
    for (const leak of ['GPSDATA', 'GPSXMP', 'IPTC-CITY', 'a COM segment', 'MPF-secondary']) expect(contains(out, leak)).toBe(false);
    expect(contains(out, 'JFIF')).toBe(true);
    expect(contains(out, 'PROFILEBYTES')).toBe(true);
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(out.includes(entropy)).toBe(true);
    // SOI, JFIF APP0, then the rebuilt Exif APP1 holding orientation 6 and nothing else.
    const app1 = out.indexOf(Buffer.from([0xff, 0xe1]));
    expect(app1).toBe(2 + 4 + 14);
    expect(out.readUInt16BE(app1 + 2)).toBe(2 + 6 + 26);
    expect(out.subarray(app1 + 4, app1 + 10).toString('latin1')).toBe('Exif\x00\x00');
    expect(readTiffOrientation(out.subarray(app1 + 10, app1 + 36))).toBe(6);
  });

  it('adds no Exif segment when the orientation is the default, and is a no-op on a clean file', () => {
    const plain = bytes([0xff, 0xd8], seg(0xe1, bytes('Exif\x00\x00', exifTiff(1))), seg(0xda, bytes([1, 1, 0, 0, 63, 0])), entropy, [0xff, 0xd9]);
    const r = stripImageMetadata(plain);
    expect(r.ok && contains(r.bytes, 'Exif')).toBe(false);
    if (!r.ok) return;
    const again = stripImageMetadata(r.bytes);
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  it('refuses a truncated segment header, and non-images outright', () => {
    expect(stripImageMetadata(bytes([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00], 'Exif'))).toEqual({ ok: false });
    expect(stripImageMetadata(Buffer.from('<html><script>alert(1)</script>'))).toEqual({ ok: false });
    expect(stripImageMetadata(new Uint8Array(0))).toEqual({ ok: false });
  });
});

describe('stripImageMetadata — PNG', () => {
  const chunk = (type: string, data: Uint8Array | string) => {
    const d = typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    return bytes(len, type, d, [0, 0, 0, 0]); // input CRCs are not checked
  };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = bytes(
    sig,
    chunk('IHDR', bytes([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk('iCCP', 'icc\x00\x00PROFILE'),
    chunk('tEXt', 'Comment\x00GPSTEXT'),
    chunk('iTXt', 'XML:com.adobe.xmp\x00\x00\x00\x00\x00GPSXMP'),
    chunk('eXIf', exifTiff(8)),
    chunk('IDAT', 'PIXELS'),
    chunk('IEND', ''),
    'trailing GPSDATA',
  );

  it('drops text/eXIf/tIME chunks and trailing bytes, keeps the rest, and rebuilds a valid eXIf after IHDR', () => {
    const r = stripImageMetadata(png);
    expect(r).toMatchObject({ ok: true, format: 'png', changed: true });
    if (!r.ok) return;
    const out = Buffer.from(r.bytes);
    for (const leak of ['GPSTEXT', 'GPSXMP', 'GPSDATA', 'tEXt', 'iTXt']) expect(contains(out, leak)).toBe(false);
    for (const kept of ['IHDR', 'iCCP', 'PROFILE', 'IDAT', 'PIXELS', 'IEND']) expect(contains(out, kept)).toBe(true);
    const exif = out.indexOf('eXIf');
    expect(exif).toBe(8 + 25 + 4); // right after the 25-byte IHDR chunk
    const len = out.readUInt32BE(exif - 4);
    const data = out.subarray(exif + 4, exif + 4 + len);
    expect(readTiffOrientation(data)).toBe(8);
    expect(out.readUInt32BE(exif + 4 + len)).toBe(zlib.crc32(out.subarray(exif, exif + 4 + len)));
    expect(out.subarray(-12, -8).readUInt32BE()).toBe(0);
    expect(out.subarray(-8, -4).toString('latin1')).toBe('IEND');
  });

  it('refuses a chunk that runs past the end', () => {
    expect(stripImageMetadata(bytes(sig, [0, 0, 0x10, 0], 'IHDR'))).toEqual({ ok: false });
  });
});

describe('stripImageMetadata — WebP', () => {
  const chunk = (fourcc: string, data: Uint8Array | string) => {
    const d = typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(d.length);
    return bytes(fourcc, size, d, d.length & 1 ? [0] : []);
  };
  const riff = (...chunks: Buffer[]) => {
    const body = Buffer.concat(chunks);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length + 4);
    return bytes('RIFF', size, 'WEBP', body);
  };
  const vp8x = chunk('VP8X', bytes([0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0])); // ICC | EXIF | XMP

  it('drops EXIF and XMP chunks, fixes the VP8X flags and the RIFF size, keeps the orientation', () => {
    const src = riff(vp8x, chunk('ICCP', 'PROFILE'), chunk('VP8 ', 'FRAME'), chunk('EXIF', bytes('Exif\x00\x00', exifTiff(3))), chunk('XMP ', 'GPSXMP'));
    const r = stripImageMetadata(src);
    expect(r).toMatchObject({ ok: true, format: 'webp', changed: true });
    if (!r.ok) return;
    const out = Buffer.from(r.bytes);
    expect(contains(out, 'GPSDATA') || contains(out, 'GPSXMP')).toBe(false);
    for (const kept of ['VP8X', 'ICCP', 'PROFILE', 'VP8 ', 'FRAME']) expect(contains(out, kept)).toBe(true);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20]).toBe(0x28); // ICC + EXIF (orientation kept), XMP cleared
    const exif = out.indexOf('EXIF');
    expect(readTiffOrientation(out.subarray(exif + 8, exif + 8 + out.readUInt32LE(exif + 4)))).toBe(3);
  });

  it('clears the EXIF flag too when there is no orientation worth keeping', () => {
    const r = stripImageMetadata(riff(vp8x, chunk('VP8 ', 'FRAME'), chunk('EXIF', exifTiff(1))));
    expect(r.ok && r.bytes[20]).toBe(0x20);
    expect(r.ok && contains(r.bytes, 'EXIF')).toBe(false);
  });
});

describe('stripImageMetadata — GIF / AVIF / sniffing', () => {
  it('drops comment and XMP application extensions, keeps loop/graphic-control/image blocks', () => {
    const gif = bytes(
      'GIF89a',
      [1, 0, 1, 0, 0, 0, 0], // 1×1, no global colour table
      [0x21, 0xfe, 7], 'GPSNOTE', [0],
      [0x21, 0xff, 11], 'XMP DataXMP', [6], 'GPSXMP', [0],
      [0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0],
      [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
      [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0],
      [0x3b],
      'trailing',
    );
    const r = stripImageMetadata(gif);
    expect(r).toMatchObject({ ok: true, format: 'gif', changed: true });
    if (!r.ok) return;
    const out = Buffer.from(r.bytes);
    for (const leak of ['GPSNOTE', 'GPSXMP', 'XMP DataXMP', 'trailing']) expect(contains(out, leak)).toBe(false);
    expect(contains(out, 'NETSCAPE2.0')).toBe(true);
    // Graphic control + the whole image block survive byte-for-byte, then the trailer.
    expect(out.subarray(-24)).toEqual(
      Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b]),
    );
  });

  it('sniffs by bytes, refuses AVIF (metadata not strippable) and everything else', () => {
    const avif = bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf');
    expect(sniffImageFormat(avif)).toBe('avif');
    // Refused whatever type it was declared as — the format comes from the bytes.
    expect(stripImageMetadata(avif)).toEqual({ ok: false });
    expect(stripImageMetadata(bytes([0, 0, 0, 0x1c], 'ftypavis', [0, 0, 0, 0], 'avismif1miaf'))).toEqual({ ok: false });
    expect(sniffImageFormat(bytes([0, 0, 0, 0x14], 'ftypisom', [0, 0, 0, 0], 'mp41'))).toBeNull();
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageFormat(bytes([0xff, 0xd8, 0xff]))).toBe('jpeg');
  });
});

// ─── Disk I/O ────────────────────────────────────────────────────────────────

const openFdCount = () => {
  for (const dir of ['/proc/self/fd', '/dev/fd']) {
    try {
      return fs.readdirSync(dir).length;
    } catch {
      /* next */
    }
  }
  return -1;
};

// Disk-backed tests are generous on time: they ran into vitest's 5 s default
// once on a host with load average ~32 (sharing the box with a dev server), and
// nothing in them is timing-dependent beyond "eventually finishes".
const DISK_TEST_TIMEOUT_MS = 30_000;

describe('openProfileMediaBody', { timeout: DISK_TEST_TIMEOUT_MS }, () => {
  const key = newProfileMediaKey('loop', 'mp4', profileMediaOwnerTag('user-disk', 'secret-secret-secret'));
  // 300 KB: still more than one 256 KB read, so a whole-file body spans two pulls.
  const content = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));

  async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
    const parts: Buffer[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  }

  it('serves exactly the requested inclusive range', async () => {
    const full = profileMediaAbsPath(key)!;
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
    expect(await readAll(openProfileMediaBody(key, 0, content.length - 1)!)).toEqual(content);
    expect(await readAll(openProfileMediaBody(key, 262_140, 262_149)!)).toEqual(content.subarray(262_140, 262_150));
    expect(await readAll(openProfileMediaBody(key, content.length - 5, content.length - 1)!)).toEqual(content.subarray(-5));
    expect(openProfileMediaBody(key, 5, 4)).toBeNull();
    expect(openProfileMediaBody('images/x.png', 0, 1)).toBeNull();
  });

  it('holds NO file descriptor for a body nobody reads (the HEAD / early-disconnect leak)', async () => {
    const before = openFdCount();
    if (before < 0) return; // no fd listing on this platform
    const unread = Array.from({ length: 40 }, () => openProfileMediaBody(key, 0, content.length - 1));
    await new Promise((r) => setTimeout(r, 50));
    expect(openFdCount()).toBeLessThanOrEqual(before + 1);
    // Reading a little then cancelling releases the descriptor again.
    const reader = unread[0]!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(openFdCount()).toBeLessThanOrEqual(before + 1);
  });

  it('fails the body (never ends it short) when the file is gone or shrank', async () => {
    const missing = openProfileMediaBody(newProfileMediaKey('loop', 'mp4', profileMediaOwnerTag('u', 'secret-secret-secret')), 0, 9)!;
    await expect(readAll(missing)).rejects.toThrow();
    await expect(readAll(openProfileMediaBody(key, 0, content.length + 10)!)).rejects.toThrow('short_read');
  });
});

describe('saveProfileMediaStream', { timeout: DISK_TEST_TIMEOUT_MS }, () => {
  const tag = profileMediaOwnerTag('user-save', 'secret-secret-secret');
  const chunks = (n: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(size).fill(7));
        c.close();
      },
    });

  it('writes the body and returns its size', async () => {
    const key = newProfileMediaKey('image', 'png', tag);
    expect(await saveProfileMediaStream(key, chunks(3, 64_000), 1_000_000)).toBe(192_000);
    expect((await fsp.stat(profileMediaAbsPath(key)!)).size).toBe(192_000);
  });

  it('removes the partial file when the cap is exceeded or the body is empty', async () => {
    const big = newProfileMediaKey('image', 'png', tag);
    await expect(saveProfileMediaStream(big, chunks(4, 64_000), 100_000)).rejects.toThrow('file_too_large');
    expect(fs.existsSync(profileMediaAbsPath(big)!)).toBe(false);
    const empty = newProfileMediaKey('image', 'png', tag);
    await expect(saveProfileMediaStream(empty, chunks(0, 0), 100_000)).rejects.toThrow('empty_body');
    expect(fs.existsSync(profileMediaAbsPath(empty)!)).toBe(false);
  });

  it('rejects promptly on a write error instead of waiting forever for drain', async () => {
    const key = newProfileMediaKey('image', 'png', tag);
    // A directory where the file should go: the stream errors (EISDIR) after
    // the first write has already filled its buffer past highWaterMark.
    await fsp.mkdir(profileMediaAbsPath(key)!, { recursive: true });
    await expect(saveProfileMediaStream(key, chunks(8, 64_000), 10_000_000)).rejects.toThrow();
  });
});

// ─── Abandoned-upload sweep ──────────────────────────────────────────────────

describe('classifyOwnProfileMediaEntry', () => {
  const tag = profileMediaOwnerTag('user-sweep', 'secret-secret-secret');
  const other = profileMediaOwnerTag('someone-else', 'secret-secret-secret');
  const name = (key: string) => key.slice(key.indexOf('/') + 1);

  it("keeps the caller's finished keys, per kind folder", () => {
    for (const [kind, ext] of [
      ['image', 'webp'],
      ['video', 'mov'],
      ['poster', 'jpg'],
      ['loop', 'mp4'],
    ] as const) {
      const key = newProfileMediaKey(kind, ext, tag);
      expect(classifyOwnProfileMediaEntry(kind, name(key), tag)).toEqual({ relPath: key, key });
    }
  });

  it('reports .tmp leftovers as unreferenceable files, not keys', () => {
    const img = newProfileMediaKey('image', 'png', tag);
    expect(classifyOwnProfileMediaEntry('image', `${name(img)}.tmp`, tag)).toEqual({ relPath: `${img}.tmp`, key: null });
    const loop = newProfileMediaKey('loop', 'mp4', tag);
    expect(classifyOwnProfileMediaEntry('loop', `${name(loop)}.tmp.mp4`, tag)).toEqual({
      relPath: `${loop}.tmp.mp4`,
      key: null,
    });
    expect(classifyOwnProfileMediaEntry('image', `${name(img)}.tmpx/../x`, tag)).toBeNull();
  });

  it("never touches another member's file, a legacy untagged key, or a key in the wrong folder", () => {
    const theirs = newProfileMediaKey('image', 'png', other);
    expect(classifyOwnProfileMediaEntry('image', name(theirs), tag)).toBeNull();
    expect(classifyOwnProfileMediaEntry('image', `${name(theirs)}.tmp`, tag)).toBeNull();
    expect(classifyOwnProfileMediaEntry('image', 'V1StGXR8_Z5jdHi6B-myT.png', tag)).toBeNull();
    const mp4 = newProfileMediaKey('video', 'mp4', tag);
    expect(classifyOwnProfileMediaEntry('image', name(mp4), tag)).toBeNull(); // .mp4 is not an image key
    expect(classifyOwnProfileMediaEntry('image', `${tag}-`, tag)).toBeNull();
    expect(classifyOwnProfileMediaEntry('image', '.', tag)).toBeNull();
  });
});

describe('listStaleOwnProfileMedia / deleteOwnProfileMediaEntries', { timeout: DISK_TEST_TIMEOUT_MS }, () => {
  const tag = profileMediaOwnerTag('user-list', 'secret-secret-secret');
  const other = profileMediaOwnerTag('user-list-other', 'secret-secret-secret');
  const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
  const OLD = new Date(NOW - PROFILE_UPLOAD_ORPHAN_AGE_MS - 60_000);
  const FRESH = new Date(NOW - 60_000);

  async function put(relPath: string, when: Date): Promise<string> {
    const full = path.join(TMP_STORAGE, 'uploads', PROFILE_MEDIA_DIR, relPath);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, 'x');
    await fsp.utimes(full, when, when); // mtime is the age signal — set it, never wait for it
    return full;
  }

  it('lists only my entries older than the cutoff, and deletes exactly those', async () => {
    const oldImage = newProfileMediaKey('image', 'png', tag);
    const oldVideo = newProfileMediaKey('video', 'mp4', tag);
    const oldTmp = `${newProfileMediaKey('loop', 'mp4', tag)}.tmp.mp4`;
    const freshPoster = newProfileMediaKey('poster', 'jpg', tag);
    const theirsOld = newProfileMediaKey('image', 'png', other);
    const files = {
      oldImage: await put(oldImage, OLD),
      oldVideo: await put(oldVideo, OLD),
      oldTmp: await put(oldTmp, OLD),
      freshPoster: await put(freshPoster, FRESH),
      theirsOld: await put(theirsOld, OLD),
    };
    // A directory named like one of my keys is never a file to delete.
    await fsp.mkdir(path.join(TMP_STORAGE, 'uploads', PROFILE_MEDIA_DIR, newProfileMediaKey('image', 'gif', tag)), {
      recursive: true,
    });

    const stale = await listStaleOwnProfileMedia(tag, { now: NOW });
    const byPath = (a: { relPath: string }, b: { relPath: string }) => a.relPath.localeCompare(b.relPath);
    expect([...stale].sort(byPath)).toEqual(
      [
        { relPath: oldImage, key: oldImage },
        { relPath: oldVideo, key: oldVideo },
        { relPath: oldTmp, key: null },
      ].sort(byPath),
    );

    await deleteOwnProfileMediaEntries(stale);
    expect(fs.existsSync(files.oldImage)).toBe(false);
    expect(fs.existsSync(files.oldVideo)).toBe(false);
    expect(fs.existsSync(files.oldTmp)).toBe(false);
    expect(fs.existsSync(files.freshPoster)).toBe(true);
    expect(fs.existsSync(files.theirsOld)).toBe(true);
  });

  it('bounds the work and survives missing folders', async () => {
    const lonely = profileMediaOwnerTag('user-list-nothing', 'secret-secret-secret');
    expect(await listStaleOwnProfileMedia(lonely, { now: NOW })).toEqual([]);
    for (let i = 0; i < 4; i++) await put(newProfileMediaKey('poster', 'jpg', tag), OLD);
    expect((await listStaleOwnProfileMedia(tag, { now: NOW, maxFiles: 2 })).length).toBe(2);
    expect(await listStaleOwnProfileMedia(tag, { now: NOW, maxScanPerDir: 0 })).toEqual([]);
  });

  it('ignores an entry that would resolve outside profile-card/', async () => {
    const outside = path.join(TMP_STORAGE, 'uploads', 'images', 'keep.png');
    await fsp.mkdir(path.dirname(outside), { recursive: true });
    await fsp.writeFile(outside, 'x');
    await deleteOwnProfileMediaEntries([{ relPath: '../images/keep.png', key: null }]);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

afterAll(async () => {
  await fsp.rm(TMP_STORAGE, { recursive: true, force: true });
});
