// Header decisions for user-uploaded bytes (lib/uploads/serve.ts). The route
// is a thin shell around these, so this is where "never serve user HTML/SVG/JS
// as an active document" and "a ?name= cannot deliver run.bat" are pinned — and
// where the nginx X-Accel mirror is checked against the same extension set.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INLINE_AUDIO_EXTS, INLINE_VIDEO_EXTS, RASTER_IMAGE_EXTS } from '@/lib/files/file-types';
import { buildRangeResponse, contentDisposition, mediaHeaders, parseByteRange, safeDownloadName } from '@/lib/uploads/serve';

describe('mediaHeaders', () => {
  it('html / svg / xml / js are attachment text with nosniff, sandbox CSP and CORP', () => {
    for (const key of ['file/a.html', 'file/a.htm', 'file/a.svg', 'file/a.xml', 'file/a.js', 'file/a.xhtml']) {
      const { serveClass, headers } = mediaHeaders(key, { name: 'x' });
      expect(serveClass).toBe('download');
      expect(headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(headers['content-disposition'].startsWith('attachment;')).toBe(true);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-security-policy']).toBe('sandbox');
      expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    }
  });

  it('opaque formats are octet-stream attachments', () => {
    const { headers } = mediaHeaders('file/a.exe', { name: 'setup.exe' });
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['content-disposition']).toContain('attachment;');
    expect(headers['content-security-policy']).toBe('sandbox');
  });

  it('inline media keep their real type, inline disposition and NO sandbox (a sandboxed PDF will not render)', () => {
    for (const [key, type] of [
      ['file/a.pdf', 'application/pdf'],
      ['preview/a.pdf', 'application/pdf'],
      ['image/a.png', 'image/png'],
      ['video/a.mp4', 'video/mp4'],
      ['file/a.mp3', 'audio/mpeg'],
    ] as const) {
      const { headers } = mediaHeaders(key, { name: 'n' });
      expect(headers['content-type']).toBe(type);
      expect(headers['content-disposition'].startsWith('inline;')).toBe(true);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-security-policy']).toBeUndefined();
      expect(headers['cross-origin-resource-policy']).toBeUndefined();
    }
  });

  it('CJK filenames never break the ByteString header', () => {
    const { headers } = mediaHeaders('file/a.pdf', { name: '季度报告.pdf' });
    const value = headers['content-disposition'];
    expect(/^[ -~]*$/.test(value)).toBe(true);
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent('季度报告.pdf')}`);
    expect(() => new Headers({ 'content-disposition': value })).not.toThrow();
  });
});

describe('safeDownloadName — the key decides the extension', () => {
  it('a ?name= cannot turn a text key into a script', () => {
    expect(safeDownloadName('run.bat', 'file/k.txt')).toBe('run.bat.txt');
    expect(safeDownloadName('update.ps1', 'file/k.log')).toBe('update.ps1.log');
    expect(safeDownloadName('evil.hta', 'file/k.bin')).toBe('evil.hta.bin');
  });

  it('keeps a matching name as typed (jpeg ≡ jpg, compound archives)', () => {
    expect(safeDownloadName('main.py', 'file/k.py')).toBe('main.py');
    expect(safeDownloadName('Report.PDF', 'file/k.pdf')).toBe('Report.PDF');
    expect(safeDownloadName('photo.jpeg', 'image/k.jpg')).toBe('photo.jpeg');
    expect(safeDownloadName('data.tar.gz', 'file/k.gz')).toBe('data.tar.gz');
  });

  it('extension-less originals stay extension-less; junk falls back to the key basename', () => {
    expect(safeDownloadName('Makefile', 'file/k.bin')).toBe('Makefile');
    expect(safeDownloadName('report', 'file/k.pdf')).toBe('report.pdf');
    expect(safeDownloadName('', 'file/k.pdf')).toBe('k.pdf');
    expect(safeDownloadName(null, 'file/k.pdf')).toBe('k.pdf');
    expect(safeDownloadName(' ... ', 'file/k.pdf')).toBe('k.pdf');
  });

  it('strips quotes, slashes, backslashes and control characters', () => {
    expect(safeDownloadName('a"b\\c/d\r\n.txt', 'file/k.txt')).toBe('a b c d .txt');
  });

  it('contentDisposition escapes RFC 5987 specials', () => {
    expect(contentDisposition('attachment', "it's (1)!.txt")).toBe(
      `attachment; filename="it's (1)!.txt"; filename*=UTF-8''it%27s%20%281%29%21.txt`,
    );
  });
});

describe('parseByteRange', () => {
  it('handles a-b, a- and the suffix form', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseByteRange('bytes=0-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });

  it('ignores absent / malformed / multi ranges and 416s a start past the end', () => {
    expect(parseByteRange(null, 1000)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toEqual({ kind: 'full' });
    expect(parseByteRange('items=0-1', 1000)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=-', 1000)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=9-3', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('buildRangeResponse', () => {
  const bytes = new TextEncoder().encode('hello world');
  const open = (start: number, end: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(start, end + 1));
        c.close();
      },
    });
  const headers = mediaHeaders('file/k.txt', { name: 'a.txt' }).headers;

  it('206 with content-range, and the security headers ride along', async () => {
    const res = buildRangeResponse({ rangeHeader: 'bytes=0-4', size: bytes.length, headers, open });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-4/${bytes.length}`);
    expect(res.headers.get('content-length')).toBe('5');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(await res.text()).toBe('hello');
  });

  it('200 without Range, 416 past the end, 200 empty for a 0-byte file', async () => {
    const full = buildRangeResponse({ rangeHeader: null, size: bytes.length, headers, open });
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('hello world');
    const bad = buildRangeResponse({ rangeHeader: 'bytes=50-', size: bytes.length, headers, open });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    const empty = buildRangeResponse({ rangeHeader: 'bytes=0-10', size: 0, headers, open });
    expect(empty.status).toBe(200);
    expect(empty.headers.get('content-length')).toBe('0');
  });
});

describe('nginx X-Accel mirror', () => {
  const conf = fs.readFileSync(path.resolve(__dirname, '../deploy/ai-community.nginx.conf'), 'utf8');

  it('the inline-extension maps equal the file-types inline set', () => {
    const inline = new Set([...RASTER_IMAGE_EXTS, ...INLINE_VIDEO_EXTS, ...INLINE_AUDIO_EXTS, 'pdf']);
    for (const name of ['aic_download_csp', 'aic_download_corp']) {
      const block = new RegExp(`map \\$uri \\$${name} \\{([\\s\\S]*?)\\}`).exec(conf);
      expect(block, name).not.toBeNull();
      const m = /"~\*\\\.\(([^)]+)\)\$"\s+""/.exec(block![1]);
      expect(m, name).not.toBeNull();
      expect(new Set(m![1].split('|'))).toEqual(inline);
    }
  });

  it('both attachment internal locations add the three headers', () => {
    for (const loc of ['_zonemedia', '_postmedia']) {
      const block = new RegExp(`location \\^~ /${loc}/ \\{([\\s\\S]*?)\\n\\}`).exec(conf);
      expect(block, loc).not.toBeNull();
      expect(block![1]).toContain('add_header X-Content-Type-Options nosniff always;');
      expect(block![1]).toContain('add_header Content-Security-Policy $aic_download_csp always;');
      expect(block![1]).toContain('add_header Cross-Origin-Resource-Policy $aic_download_corp always;');
    }
  });
});
