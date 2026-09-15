// 讨论区 attachments accept ANY file now. What must never break while the
// accepted set widens:
//   1. LOCKSTEP — every key the upload side can write (postMediaExtFor →
//      newPostMediaKey) passes every reader: the key regexes, resolveMedia, the
//      URL round trip. A key the storage produced but a validator rejected would
//      make the topic unsaveable on its next edit, and — had resolveMedia ever
//      filtered instead of refusing — drop the row and unlink the file.
//   2. ALL OR NOTHING — resolveMedia refuses a whole list over one bad item, so
//      `removedUploadKeys` (what a topic edit reclaims from disk) can only ever
//      run against a list that kept everything the author did not remove.
//   3. The limits are one set of numbers (picker, zod, resolveMedia).
//   4. Serving decisions come from the KEY's extension (shared with 技术专区).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  MAX_POST_FILES,
  MAX_POST_IMAGES,
  MAX_POST_MEDIA_ITEMS,
  POST_FILE_KEY_RE,
  POST_MEDIA_KEY_RE,
  POST_VIDEO_KEY_RE,
  isAllowedPostVideoType,
  isValidPostMediaKey,
  postMediaExtFor,
  postMediaKeyFromUrl,
  postMediaPublicUrl,
} from '@/lib/uploads/post-media-keys';
import { newPostMediaKey, postMediaContentType } from '@/lib/uploads/post-media-storage';
import { mediaArraySchema, removedUploadKeys, resolveMedia, type MediaInput } from '@/lib/discussion-media';
import { mediaHeaders } from '@/lib/uploads/serve';
import { SAFE_KEY_EXT_PATTERN } from '@/lib/files/file-types';
import { fileDownloadHref } from '@/lib/files/display';
import {
  discussionFileExt,
  discussionFileTarget,
  fileTileClass,
  isDownloadOnlyFile,
} from '@/app/discussion/_components/file-attachments';

const fileItem = (key: string, name = 'x'): MediaInput => ({ kind: 'file', key, name, mimeType: '', sizeBytes: 1 });
const videoItem = (key: string): MediaInput => ({ kind: 'video', key, name: 'v.mp4', mimeType: 'video/mp4', sizeBytes: 1 });
const imageItem = (i: number): MediaInput => ({ kind: 'image', key: `images/img${i}.png`, name: '', mimeType: 'image/png', sizeBytes: 1 });

// What browsers actually report (research: chrome-headless-shell on macOS) — most source files come with NO type.
const FILE_UPLOADS: [name: string, mime: string, expectedExt: string][] = [
  ['batcher.py', 'text/x-python-script', 'py'],
  ['main.ts', '', 'ts'],
  ['main.ts', 'video/mp2t', 'ts'], // Windows registries map .ts to MPEG-TS
  ['kernel.c', '', 'c'], // 1-char extensions the old {2,5} pattern rejected
  ['analysis.r', '', 'r'],
  ['app.properties', '', 'properties'], // 10 chars — the widest accepted
  ['build.gradle', '', 'gradle'],
  ['Makefile', '', 'bin'], // no extension at all
  ['LICENSE', 'text/plain', 'txt'], // no extension, MIME hint
  ['dump.tar.gz', 'application/x-gzip', 'gz'],
  ['setup.EXE', 'application/x-msdownload', 'exe'], // uppercase name, lowercase key
  ['page.html', 'text/html', 'html'], // stored as-is, SERVED as text/plain
  ['logo.svg', 'image/svg+xml', 'svg'],
  ['weird.a-b', '', 'bin'], // unusable extension
  ['x.averylongext', '', 'bin'], // 12 chars
  ['../../etc/passwd', '', 'bin'],
  ['..\\..\\evil.bat', '', 'bat'],
  ['模型说明.md', 'text/markdown', 'md'],
  ['数据.csv', 'text/csv', 'csv'],
  ['report.pdf', 'application/pdf', 'pdf'],
  ['deck.pptx', '', 'pptx'],
  ['bundle.zip', 'application/zip', 'zip'],
  ['notes', 'application/octet-stream', 'bin'],
  ['', '', 'bin'],
];

describe('post media keys — the writer and every reader agree', () => {
  it.each(FILE_UPLOADS)('file %j (%j) stores a key every reader accepts', (name, mime, expectedExt) => {
    const ext = postMediaExtFor('file', mime, name);
    expect(ext).toBe(expectedExt);
    expect(ext).toMatch(new RegExp(`^${SAFE_KEY_EXT_PATTERN}$`));

    const key = newPostMediaKey('file', ext);
    expect(POST_FILE_KEY_RE.test(key)).toBe(true);
    expect(POST_MEDIA_KEY_RE.test(key)).toBe(true);
    expect(isValidPostMediaKey(key)).toBe(true);
    expect(isValidPostMediaKey(key, 'file')).toBe(true);
    expect(isValidPostMediaKey(key, 'video')).toBe(false);

    const url = postMediaPublicUrl(key);
    expect(postMediaKeyFromUrl(url)).toBe(key);

    const resolved = resolveMedia([fileItem(key, name)]);
    expect(resolved).not.toBeNull();
    expect(resolved![0]).toMatchObject({ kind: 'file', key, url });
  });

  it.each([
    ['video/mp4', 'clip.mp4', 'mp4'],
    ['video/webm', 'clip.webm', 'webm'],
    ['video/quicktime', 'clip.MOV', 'mov'],
    ['video/mp4', '', 'mp4'],
  ])('video %s / %j stores an inline container key', (mime, name, expectedExt) => {
    expect(isAllowedPostVideoType(mime)).toBe(true);
    const key = newPostMediaKey('video', postMediaExtFor('video', mime, name));
    expect(key.endsWith(`.${expectedExt}`)).toBe(true);
    expect(POST_VIDEO_KEY_RE.test(key)).toBe(true);
    expect(isValidPostMediaKey(key, 'video')).toBe(true);
    expect(resolveMedia([videoItem(key)])).not.toBeNull();
  });

  it('keeps video strict: only the three inline containers are a video', () => {
    for (const type of ['video/mp2t', 'video/x-matroska', 'text/plain', '', 'application/octet-stream']) {
      expect(isAllowedPostVideoType(type)).toBe(false);
    }
    // The inherited prototype must not read as a registered type.
    expect(isAllowedPostVideoType('toString')).toBe(false);
    expect(postMediaExtFor('video', '', 'movie.mkv')).toBe('mp4');
    expect(isValidPostMediaKey('video/abc.py', 'video')).toBe(false);
    expect(resolveMedia([videoItem('video/abc.py')])).toBeNull();
    expect(resolveMedia([videoItem('file/abc.mp4')])).toBeNull();
  });

  it('still accepts every key the OLD allowlist wrote (existing rows keep working)', () => {
    for (const ext of ['pdf', 'ppt', 'pptx', 'doc', 'docx']) {
      expect(resolveMedia([fileItem(`file/V1StGXR8_Z5jdHi6B-myT.${ext}`)])).not.toBeNull();
    }
    for (const ext of ['mp4', 'webm', 'mov']) {
      expect(resolveMedia([videoItem(`video/V1StGXR8_Z5jdHi6B-myT.${ext}`)])).not.toBeNull();
    }
  });

  it.each([
    'file/../secret.py',
    'file/..%2Fsecret.py',
    'file/x.PY', // uppercase is never written
    'file/x', // no extension (the writer uses `bin`)
    'file/x.',
    'file/a.b.py', // dots in the id — also what a remux temp looks like
    'video/abc.mp4.tmp.mp4', // faststart remux output mid-flight
    'file/x.averylongex', // 11 chars
    'image/x.png', // zone prefix, not ours
    'preview/x.pdf',
    '/file/x.py',
    'file/x.py/extra',
    'file\\x.py',
    '',
  ])('rejects %j everywhere', (key) => {
    expect(isValidPostMediaKey(key)).toBe(false);
    expect(isValidPostMediaKey(key, 'file')).toBe(false);
    expect(resolveMedia([fileItem(key)])).toBeNull();
  });

  it('refuses a foreign or malformed URL instead of guessing a key', () => {
    expect(postMediaKeyFromUrl('/api/zones/media/file/abc.py')).toBeNull();
    expect(postMediaKeyFromUrl('/api/discussion/media/file/%E0%A4%A.py')).toBeNull();
    expect(postMediaKeyFromUrl('/api/discussion/media/file/..%2F..%2Fx.py')).toBeNull();
    expect(postMediaKeyFromUrl('https://evil.example/api/discussion/media/file/abc.py')).toBeNull();
    expect(postMediaKeyFromUrl(null)).toBeNull();
    // A download query never leaks into the key.
    expect(postMediaKeyFromUrl('/api/discussion/media/file/abc.py?name=x.py')).toBe('file/abc.py');
  });
});

describe('resolveMedia — limits and all-or-nothing', () => {
  it('enforces 9 images / 1 video / 4 files, and the zod cap is their sum', () => {
    expect(MAX_POST_MEDIA_ITEMS).toBe(14);
    const files = Array.from({ length: MAX_POST_FILES }, (_, i) => fileItem(`file/f${i}.py`));
    const images = Array.from({ length: MAX_POST_IMAGES }, (_, i) => imageItem(i));
    const video = videoItem('video/v1.mp4');
    expect(resolveMedia([...images, video, ...files])).toHaveLength(14);
    expect(resolveMedia([...files, fileItem('file/f9.zip')])).toBeNull();
    expect(resolveMedia([...images, imageItem(99)])).toBeNull();
    expect(resolveMedia([video, { kind: 'video_link', url: 'https://example.com/v', name: '', mimeType: '', sizeBytes: 0 }])).toBeNull();

    expect(mediaArraySchema.safeParse([...images, video, ...files]).success).toBe(true);
    expect(mediaArraySchema.safeParse([...images, video, ...files, fileItem('file/x.py')]).success).toBe(false);
  });

  it('refuses the WHOLE list over one bad key — never a filtered subset an edit could unlink from', () => {
    const stored = [
      { kind: 'file', key: 'file/keep1.properties' },
      { kind: 'file', key: 'file/keep2.c' },
      { kind: 'video', key: 'video/keep3.mp4' },
    ];
    const echoed = [fileItem('file/keep1.properties'), fileItem('file/keep2.C'), videoItem('video/keep3.mp4')];
    expect(resolveMedia(echoed)).toBeNull();
    // …and an honest echo of the stored rows reclaims nothing.
    const honest = resolveMedia([fileItem('file/keep1.properties'), fileItem('file/keep2.c'), videoItem('video/keep3.mp4')]);
    expect(honest).not.toBeNull();
    expect(removedUploadKeys(stored, honest!)).toEqual([]);
  });

  it('an edit re-saving every stored any-type attachment unlinks nothing', () => {
    const keys = FILE_UPLOADS.slice(0, MAX_POST_FILES).map(([name, mime]) => newPostMediaKey('file', postMediaExtFor('file', mime, name)));
    const stored = keys.map((key) => ({ kind: 'file', key }));
    const resolved = resolveMedia(keys.map((k) => fileItem(k)));
    expect(resolved).not.toBeNull();
    expect(removedUploadKeys(stored, resolved!)).toEqual([]);
  });

  it('removedUploadKeys returns only the uploads the author dropped', () => {
    const before = [
      { kind: 'image', key: 'images/a.png' }, // shared editor infrastructure — never reclaimed here
      { kind: 'video', key: 'video/b.mp4' },
      { kind: 'file', key: 'file/c.zip' },
      { kind: 'file', key: 'file/d.py' },
      { kind: 'video_link', key: '' },
      { kind: 'file', key: 'file/c.zip' }, // duplicate row
    ];
    const next = resolveMedia([fileItem('file/d.py')])!;
    expect(removedUploadKeys(before, next).sort()).toEqual(['file/c.zip', 'video/b.mp4']);
  });
});

describe('serving a post-media key (shared lib/uploads/serve.ts policy)', () => {
  it.each([
    ['file/a.py', 'text/plain; charset=utf-8'],
    ['file/a.html', 'text/plain; charset=utf-8'],
    ['file/a.svg', 'text/plain; charset=utf-8'],
    ['file/a.json', 'text/plain; charset=utf-8'],
    ['file/a.zip', 'application/octet-stream'],
    ['file/a.exe', 'application/octet-stream'],
    ['file/a.bin', 'application/octet-stream'],
    ['file/a.pptx', 'application/octet-stream'],
    ['file/a.pdf', 'application/pdf'],
    ['file/a.png', 'image/png'],
    ['video/a.mp4', 'video/mp4'],
    ['video/a.mov', 'video/quicktime'],
  ])('%s → %s', (key, type) => {
    expect(postMediaContentType(key)).toBe(type);
    expect(mediaHeaders(key).headers['content-type']).toBe(type);
  });

  it('downloads text-like keys under a sandbox with the key extension forced onto the name', () => {
    const { headers, serveClass } = mediaHeaders('file/abc.html', { name: '页面 run.bat' });
    expect(serveClass).toBe('download');
    expect(headers['content-disposition']).toMatch(/^attachment; /);
    expect(headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('页面 run.bat.html')}`);
    expect(headers['content-security-policy']).toBe('sandbox');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps PDF and video inline without the sandbox (Chromium will not render a sandboxed PDF)', () => {
    for (const key of ['file/abc.pdf', 'video/abc.mp4']) {
      const { headers } = mediaHeaders(key, { name: '报告.pdf' });
      expect(headers['content-disposition']).toMatch(/^inline; /);
      expect(headers['content-security-policy']).toBeUndefined();
    }
  });
});

describe('file cards (app/discussion/_components/file-attachments.ts)', () => {
  it('says 仅下载 exactly when the viewer has no renderer for the key', () => {
    for (const [key, name] of [
      ['file/a.zip', 'bundle.zip'],
      ['file/a.exe', 'setup.exe'],
      ['file/a.pptx', 'deck.pptx'], // no office rendition in 讨论区
      ['file/a.docx', 'spec.docx'],
      ['file/a.gz', 'dump.tar.gz'],
      ['file/a.bin', 'weird.a-b'], // had an extension, fell back — not guessed at
    ]) {
      expect(isDownloadOnlyFile(key, name)).toBe(true);
    }
    for (const [key, name] of [
      ['file/a.py', 'batcher.py'],
      ['file/a.json', 'bench.json'],
      ['file/a.csv', '数据.csv'],
      ['file/a.md', 'README.md'],
      ['file/a.pdf', 'report.pdf'],
      ['file/a.html', 'page.html'], // source view
      ['file/a.png', 'shot.png'],
      ['file/a.bin', 'Makefile'], // sniffed at open: promises nothing either way
    ]) {
      expect(isDownloadOnlyFile(key, name)).toBe(false);
    }
  });

  it('builds a viewer target only for a real post-media URL', () => {
    const url = postMediaPublicUrl('file/abc.py');
    expect(discussionFileTarget({ url, name: 'x.py', sizeBytes: 3 })).toEqual({ url, storageKey: 'file/abc.py', name: 'x.py', sizeBytes: 3 });
    expect(discussionFileTarget({ url: '/api/uploads/images/abc.png', name: 'x', sizeBytes: 3 })).toBeNull();
  });

  it('download href carries the CJK display name encoded (the shared lib/files/display builder)', () => {
    expect(fileDownloadHref('/api/discussion/media/file/abc.py', '模型.py')).toBe(
      `/api/discussion/media/file/abc.py?name=${encodeURIComponent('模型.py')}`,
    );
    expect(fileDownloadHref('/api/discussion/media/file/abc.py', '')).toBe('/api/discussion/media/file/abc.py?name=attachment');
  });

  it('display extension is compound-aware and never the bin placeholder', () => {
    expect(discussionFileExt({ name: 'dump.tar.gz', storageKey: 'file/a.gz' })).toBe('tar.gz');
    expect(discussionFileExt({ name: 'Makefile', storageKey: 'file/a.bin' })).toBe('');
    expect(discussionFileExt({ name: 'LICENSE', storageKey: 'file/a.txt' })).toBe('txt');
  });

  it('keeps the document families their colour and everything else on the neutral tile', () => {
    expect(fileTileClass('pdf')).toContain('rose');
    expect(fileTileClass('pptx')).toContain('amber');
    expect(fileTileClass('docx')).toContain('sky');
    expect(fileTileClass('py')).toContain('zinc');
    expect(fileTileClass('')).toContain('zinc');
  });
});
