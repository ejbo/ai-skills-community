// The two 讨论区 byte routes, run for real against a temp storage root:
//   POST /api/discussion/upload — the `file` kind takes ANY non-empty body and
//     keys it by extension (MIME is only a hint); `video` stays type-checked;
//     the per-file cap, the free-space floor and the empty-body refusal hold.
//   GET /api/discussion/media/[...key] — login, a SHAPE-checked key (remux temps
//     and traversal 404 even when the bytes exist), headers from the shared
//     lib/uploads/serve.ts policy, Range, and the X-Accel handoff.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  // Before any import: post-media-storage resolves its root from this at load.
  process.env.LOCAL_STORAGE_DIR = `/tmp/aic-discussion-media-test-${process.pid}`;
  return {
    root: `/tmp/aic-discussion-media-test-${process.pid}`,
    session: { user: { id: 'u1' } } as { user: { id: string } } | null,
    freeSpace: true,
    xAccel: false,
  };
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => state.session) }));
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, { get: (_t, prop) => (prop === 'MEDIA_X_ACCEL_REDIRECT' ? state.xAccel : undefined) }),
}));
vi.mock('@/lib/uploads/disk-space', () => ({ hasFreeSpace: vi.fn(async () => state.freeSpace) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: 0 })) }));
vi.mock('@/lib/api-errors', () => ({ apiReason: vi.fn(async (k: string) => `reason:${k}`) }));
// lib/discussion-media imports prisma; resolveMedia never touches it.
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { POST } from '@/app/api/discussion/upload/route';
import { GET } from '@/app/api/discussion/media/[...key]/route';
import { resolveMedia } from '@/lib/discussion-media';

const MEDIA = path.join(state.root, 'post-media');

function upload(body: string | null, headers: Record<string, string>): Promise<Response> {
  return POST(new Request('http://localhost/api/discussion/upload', { method: 'POST', headers, body: body ?? undefined }));
}

function get(key: string, opts: { name?: string; range?: string } = {}): Promise<Response> {
  const segments = key.split('/');
  const qs = opts.name != null ? `?name=${encodeURIComponent(opts.name)}` : '';
  const req = new Request(`http://localhost/api/discussion/media/${segments.map(encodeURIComponent).join('/')}${qs}`, {
    headers: opts.range ? { range: opts.range } : {},
  });
  return GET(req, { params: { key: segments.map(encodeURIComponent) } });
}

function put(key: string, content: string | Buffer) {
  const full = path.join(MEDIA, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  state.session = { user: { id: 'u1' } };
  state.freeSpace = true;
  state.xAccel = false;
});

afterAll(() => {
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe('POST /api/discussion/upload', () => {
  it.each([
    ['batcher.py', '', 'py', 'print("你好")\n'],
    ['bench.json', 'application/json', 'json', '{"a":1}'],
    ['model-bundle.zip', 'application/zip', 'zip', 'PKfake'],
    ['Makefile', '', 'bin', 'all:\n\techo hi\n'],
    ['page.html', 'text/html', 'html', '<script>alert(1)</script>'],
    ['app.properties', '', 'properties', 'a=b\n'],
    ['setup.EXE', 'application/x-msdownload', 'exe', 'MZ'],
  ])('file kind accepts %s (%j) → .%s key, bytes on disk, and resolveMedia accepts the key', async (name, mime, ext, content) => {
    const res = await upload(content, {
      'content-type': mime,
      'x-upload-kind': 'file',
      'x-filename': encodeURIComponent(name),
      'content-length': String(Buffer.byteLength(content)),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { key: string; url: string; size: number };
    expect(json.key).toMatch(new RegExp(`^file/[A-Za-z0-9_-]+\\.${ext}$`));
    expect(json.url).toBe(`/api/discussion/media/${json.key}`);
    expect(json.size).toBe(Buffer.byteLength(content));
    expect(fs.readFileSync(path.join(MEDIA, json.key), 'utf8')).toBe(content);
    expect(resolveMedia([{ kind: 'file', key: json.key, name, mimeType: mime, sizeBytes: json.size }])).not.toBeNull();
  });

  it('keeps the video kind type-checked', async () => {
    const res = await upload('not a video', { 'content-type': 'text/plain', 'x-upload-kind': 'video', 'x-filename': 'a.mp4' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'unsupported_type' });
  });

  it('refuses an empty file (declared 0 bytes, and an undeclared empty body)', async () => {
    const declared = await upload('', { 'x-upload-kind': 'file', 'x-filename': 'empty.py', 'content-length': '0' });
    expect(declared.status).toBe(400);
    expect(await declared.json()).toEqual({ error: 'empty_body' });
    const streamed = await upload(null, { 'x-upload-kind': 'file', 'x-filename': 'empty.py' });
    expect(streamed.status).toBe(400);
  });

  it('refuses a declared size over the 100 MB file cap before writing', async () => {
    const res = await upload('x', { 'x-upload-kind': 'file', 'x-filename': 'big.zip', 'content-length': String(100 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it('answers 507 when the volume is short, before touching the disk', async () => {
    state.freeSpace = false;
    const res = await upload('abc', { 'x-upload-kind': 'file', 'x-filename': 'x.py', 'content-length': '3' });
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ error: 'insufficient_storage' });
  });

  it('needs a session', async () => {
    state.session = null;
    const res = await upload('abc', { 'x-upload-kind': 'file', 'x-filename': 'x.py' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/discussion/media/[...key]', () => {
  it('serves a .py as a sandboxed text/plain download named with the key extension forced on', async () => {
    put('file/abcPY.py', 'print(1)\n');
    const res = await get('file/abcPY.py', { name: 'run.bat' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="run.bat.py"; filename*=UTF-8''run.bat.py`);
    expect(await res.text()).toBe('print(1)\n');
  });

  it('never serves stored HTML as HTML', async () => {
    put('file/abcHTML.html', '<script>alert(1)</script>');
    const res = await get('file/abcHTML.html', { name: '页面.html' });
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('页面.html')}`);
    // header values must stay ByteStrings (a raw CJK name would have thrown)
    expect(res.headers.get('content-disposition')).toMatch(/^[\x20-\x7e]+$/);
  });

  it('keeps PDF inline without the sandbox, and a zip as octet-stream', async () => {
    put('file/abcPDF.pdf', '%PDF-1.4');
    const pdf = await get('file/abcPDF.pdf');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toMatch(/^inline; /);
    expect(pdf.headers.get('content-security-policy')).toBeNull();

    put('file/abcZIP.zip', 'PK');
    const zip = await get('file/abcZIP.zip');
    expect(zip.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers Range with 206 and an unsatisfiable one with 416', async () => {
    put('file/abcRANGE.txt', '0123456789');
    const part = await get('file/abcRANGE.txt', { range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    const suffix = await get('file/abcRANGE.txt', { range: 'bytes=-3' });
    expect(await suffix.text()).toBe('789');
    const bad = await get('file/abcRANGE.txt', { range: 'bytes=50-' });
    expect(bad.status).toBe(416);
  });

  it('404s a key of the wrong shape even when the bytes exist (remux temp, uppercase, no extension)', async () => {
    put('video/abcTMP.mp4.tmp.mp4', 'partial');
    put('file/abcUP.PY', 'x');
    put('file/noext', 'x');
    put('stray.txt', 'x');
    for (const key of ['video/abcTMP.mp4.tmp.mp4', 'file/abcUP.PY', 'file/noext', 'stray.txt']) {
      expect((await get(key)).status).toBe(404);
    }
    // traversal and malformed escapes
    const traversal = await GET(new Request('http://localhost/api/discussion/media/file/..%2F..%2Fx.py'), {
      params: { key: ['file', '..%2F..%2Fx.py'] },
    });
    expect(traversal.status).toBe(404);
    const malformed = await GET(new Request('http://localhost/api/discussion/media/file/%E0%A4%A.py'), {
      params: { key: ['file', '%E0%A4%A.py'] },
    });
    expect(malformed.status).toBe(404);
  });

  it('404s a well-formed key with no file, and 401s without a session', async () => {
    expect((await get('file/missing.py')).status).toBe(404);
    state.session = null;
    put('file/abcAUTH.py', 'x');
    expect((await get('file/abcAUTH.py')).status).toBe(401);
  });

  it('hands the bytes to nginx under X-Accel with the policy headers kept', async () => {
    state.xAccel = true;
    put('file/abcXA.json', '{}');
    const res = await get('file/abcXA.json', { name: 'bench.json' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-accel-redirect')).toBe('/_postmedia/file/abcXA.json');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-length')).toBeNull();
    // A 0-byte file is answered by the app (nginx would 416 a Range against it).
    put('file/abcZERO.txt', '');
    const zero = await get('file/abcZERO.txt');
    expect(zero.headers.get('x-accel-redirect')).toBeNull();
    expect(zero.headers.get('content-length')).toBe('0');
  });
});
