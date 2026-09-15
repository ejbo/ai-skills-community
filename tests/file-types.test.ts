// The single file-type table (lib/files/file-types.ts) decides storage, serving
// and preview for every attachment. These pins are the security contract of
// "any file can be attached": active formats are never served inline or with
// their real type, key extensions stay inside the shape every key regex
// accepts, and the regexes widen together.
import { describe, expect, it } from 'vitest';
import {
  BINARY_EXTENSIONS,
  DANGEROUS_EXTS,
  EXT_LANG,
  FALLBACK_KEY_EXT,
  TEXT_EXTENSIONS,
  contentTypeFor,
  displayExtOf,
  extFromMime,
  extOfName,
  isDangerousExt,
  isInlineVideo,
  isRasterImage,
  keyExtOf,
  languageForName,
  lastExtOfName,
  opensInBrowser,
  previewClassOf,
  previewPlanFor,
  safeKeyExt,
  serveClassOf,
  uploadContentTypeFor,
} from '@/lib/files/file-types';
import { EMBED_FILE_KEY_RE, ZONE_MEDIA_KEY_RE, extOfName as zoneExtOfName, isEmbedFileKey, parseEmbedToken } from '@/lib/zones/shared';
import { isValidZoneMediaKey, newZoneMediaKey, zoneMediaContentType, zoneMediaExtFor } from '@/lib/zones/storage';

describe('extensions', () => {
  it('extOfName is lowercase, 1–10 chars, compound-aware for tar archives', () => {
    expect(extOfName('Report.PDF')).toBe('pdf');
    expect(extOfName('data.tar.gz')).toBe('tar.gz');
    expect(extOfName('data.TAR.BZ2')).toBe('tar.bz2');
    expect(extOfName('logs.tar.xz')).toBe('tar.xz');
    expect(extOfName('x.min.js')).toBe('js');
    expect(extOfName('build.properties')).toBe('properties');
    expect(extOfName('a.c')).toBe('c');
    expect(extOfName('.gitignore')).toBe('gitignore');
    expect(extOfName('Makefile')).toBe('');
    expect(extOfName('x.averyverylongext')).toBe('');
    expect(extOfName('dir/sub\\file.PY')).toBe('py');
    expect(extOfName('trailing.')).toBe('');
    // the zones re-export is the same function
    expect(zoneExtOfName('data.tar.gz')).toBe('tar.gz');
  });

  it('lastExtOfName and keyExtOf never return a compound', () => {
    expect(lastExtOfName('data.tar.gz')).toBe('gz');
    expect(keyExtOf('file/abc_123.gz')).toBe('gz');
    expect(keyExtOf('/api/zones/media/file/abc.TXT?name=x')).toBe('txt');
    expect(keyExtOf('file/abc')).toBe('');
  });

  it('safeKeyExt clamps to [a-z0-9]{1,10}, MIME only as a hint, else bin', () => {
    expect(safeKeyExt('main.py', '')).toBe('py');
    expect(safeKeyExt('Main.PY', 'text/x-python-script')).toBe('py');
    expect(safeKeyExt('types.ts', 'video/mp2t')).toBe('ts');
    expect(safeKeyExt('archive.tar.gz')).toBe('gz');
    expect(safeKeyExt('config.properties')).toBe('properties');
    expect(safeKeyExt('Makefile')).toBe(FALLBACK_KEY_EXT);
    expect(safeKeyExt('report', 'application/pdf')).toBe('pdf');
    expect(safeKeyExt('page', 'text/html')).toBe('bin'); // html is never a MIME-derived key
    expect(safeKeyExt('x.averyverylongext')).toBe('bin');
    expect(safeKeyExt('evil.p-hp')).toBe('bin');
    expect(safeKeyExt('../../etc/passwd')).toBe('bin');
    expect(safeKeyExt('')).toBe('bin');
    for (const n of ['a.c', 'a.h', 'b.r', 'x.gradle', 'y.jsonl', 'z.7z', 'Dockerfile', 'weird.名字', 'a.b c']) {
      expect(safeKeyExt(n)).toMatch(/^[a-z0-9]{1,10}$/);
    }
  });

  it('extFromMime maps the known set and nothing else', () => {
    expect(extFromMime('application/pdf')).toBe('pdf');
    expect(extFromMime('text/plain; charset=utf-8')).toBe('txt');
    expect(extFromMime('text/html')).toBe('');
    expect(extFromMime('image/svg+xml')).toBe('');
    expect(extFromMime(null)).toBe('');
  });

  it('displayExtOf prefers the name, never shows the bin placeholder', () => {
    expect(displayExtOf('data.tar.gz', 'file/k.gz')).toBe('tar.gz');
    expect(displayExtOf('Makefile', 'file/k.bin')).toBe('');
    expect(displayExtOf('notes', 'file/k.bin', 'text/plain')).toBe('txt');
    expect(displayExtOf('', 'file/k.pdf')).toBe('pdf');
  });
});

describe('tables', () => {
  it('the text and binary tables never overlap (skill-parser relies on it)', () => {
    for (const e of TEXT_EXTENSIONS) expect(BINARY_EXTENSIONS.has(e)).toBe(false);
  });

  it('every highlight language extension is text', () => {
    for (const e of Object.keys(EXT_LANG)) expect(TEXT_EXTENSIONS.has(e)).toBe(true);
  });

  it('DANGEROUS_EXTS carries the owner’s list (a warning, not a block)', () => {
    for (const e of ['exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'hta', 'js', 'jar', 'apk', 'dmg', 'pkg', 'sh', 'scr', 'lnk', 'reg', 'com', 'app']) {
      expect(DANGEROUS_EXTS.has(e)).toBe(true);
    }
    expect(isDangerousExt('EXE')).toBe(true);
    expect(isDangerousExt('py')).toBe(false);
  });

  it('languageForName keeps CodeViewer’s basename rules', () => {
    expect(languageForName('scripts/run.py')).toBe('python');
    expect(languageForName('Dockerfile')).toBe('dockerfile');
    expect(languageForName('Makefile')).toBe('makefile');
    expect(languageForName('a/b/config.yaml')).toBe('yaml');
    expect(languageForName('LICENSE')).toBeNull();
  });
});

describe('serving — active formats are never inline and never real-typed', () => {
  const ACTIVE = ['html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs', 'shtml', 'mht', 'mhtml', 'xsl', 'hta', 'swf'];

  it('html / svg / xml / js download as text or opaque bytes', () => {
    for (const e of ACTIVE) {
      expect(serveClassOf(e)).toBe('download');
      const ct = contentTypeFor(e);
      expect(ct === 'text/plain; charset=utf-8' || ct === 'application/octet-stream').toBe(true);
      expect(ct).not.toMatch(/html|svg|xml|javascript|ecmascript|flash/);
    }
  });

  it('only the closed media set is inline, with its real type', () => {
    expect(serveClassOf('png')).toBe('inline-image');
    expect(serveClassOf('JPEG')).toBe('inline-image');
    expect(serveClassOf('mov')).toBe('inline-video');
    expect(serveClassOf('flac')).toBe('inline-audio');
    expect(serveClassOf('pdf')).toBe('inline-pdf');
    expect(contentTypeFor('jpg')).toBe('image/jpeg');
    expect(contentTypeFor('mov')).toBe('video/quicktime');
    expect(contentTypeFor('m4a')).toBe('audio/mp4');
    expect(contentTypeFor('pdf')).toBe('application/pdf');
    for (const e of ['bmp', 'tiff', 'heic', 'ico', 'mkv', 'avi', 'pptx', 'docx', 'zip', 'exe', 'bin', '']) {
      expect(serveClassOf(e)).toBe('download');
      expect(contentTypeFor(e)).toBe('application/octet-stream');
    }
  });

  it('opensInBrowser reads the KEY: only the inline set opens in a tab, never a text / html / svg key', () => {
    for (const k of ['image/a.png', 'video/a.mov', 'file/a.pdf', 'file/a.m4a', 'file/a.JPG']) expect(opensInBrowser(k), k).toBe(true);
    for (const k of ['file/a.csv', 'file/a.py', 'file/a.html', 'file/a.svg', 'file/a.docx', 'file/a.bin', 'file/noext', '']) {
      expect(opensInBrowser(k), k).toBe(false);
    }
  });

  it('text-like files are plain text', () => {
    for (const e of ['txt', 'md', 'json', 'csv', 'py', 'ts', 'yaml', 'log', 'sql', 'gitignore']) {
      expect(contentTypeFor(e)).toBe('text/plain; charset=utf-8');
    }
  });

  it('the zone storage content type is the shared decision', () => {
    expect(zoneMediaContentType('file/abc.svg')).toBe('text/plain; charset=utf-8');
    expect(zoneMediaContentType('preview/abc.pdf')).toBe('application/pdf');
    expect(zoneMediaContentType('cover/abc.webp')).toBe('image/webp');
  });
});

describe('preview decisions', () => {
  it('previewClassOf by key extension', () => {
    expect(previewClassOf('png')).toBe('image');
    expect(previewClassOf('webm')).toBe('video');
    expect(previewClassOf('mp3')).toBe('audio');
    expect(previewClassOf('pdf')).toBe('pdf');
    expect(previewClassOf('pptx')).toBe('office');
    expect(previewClassOf('md')).toBe('markdown');
    expect(previewClassOf('json')).toBe('json');
    expect(previewClassOf('ipynb')).toBe('json');
    expect(previewClassOf('csv')).toBe('csv');
    expect(previewClassOf('tsv')).toBe('csv');
    expect(previewClassOf('py')).toBe('code');
    expect(previewClassOf('html')).toBe('code'); // SOURCE, never rendered
    expect(previewClassOf('svg')).toBe('code');
    expect(previewClassOf('xml')).toBe('code');
    expect(previewClassOf('log')).toBe('text');
    expect(previewClassOf('txt')).toBe('text');
    expect(previewClassOf('zip')).toBe('none');
    expect(previewClassOf('exe')).toBe('none');
    expect(previewClassOf('bin')).toBe('none');
  });

  it('previewPlanFor trusts the KEY, not a name that claims otherwise', () => {
    expect(previewPlanFor('file/k.txt', 'totally-a.pdf').cls).toBe('text');
    expect(previewPlanFor('file/k.zip', 'readme.md').cls).toBe('none');
    expect(previewPlanFor('file/k.py', 'x.py')).toEqual({ cls: 'code', keyExt: 'py', language: 'python', sniffOnly: false });
    expect(previewPlanFor('file/k.json', 'x.json').language).toBe('json');
  });

  it('an extension-less upload (bin key, name without extension) is a sniffed text attempt', () => {
    expect(previewPlanFor('file/k.bin', 'LICENSE')).toEqual({ cls: 'text', keyExt: 'bin', language: null, sniffOnly: true });
    expect(previewPlanFor('file/k.bin', 'Dockerfile')).toMatchObject({ cls: 'code', language: 'dockerfile', sniffOnly: true });
    // a name WITH an extension that fell back to bin is not guessed at
    expect(previewPlanFor('file/k.bin', 'x.averyverylongext').cls).toBe('none');
  });
});

describe('upload classification (client)', () => {
  const f = (name: string, type = '') => ({ name, type });

  it('isRasterImage: by MIME or, with no MIME, by extension; svg / heic never', () => {
    expect(isRasterImage(f('a.png', 'image/png'))).toBe(true);
    expect(isRasterImage(f('a.png'))).toBe(true);
    expect(isRasterImage(f('a.png', 'application/octet-stream'))).toBe(true);
    expect(isRasterImage(f('photo.jfif', 'image/jpeg'))).toBe(true);
    expect(isRasterImage(f('clipboard', 'image/png'))).toBe(true);
    expect(isRasterImage(f('logo.svg', 'image/svg+xml'))).toBe(false);
    expect(isRasterImage(f('img.heic', 'image/heic'))).toBe(false);
    expect(isRasterImage(f('scan.bmp', 'image/bmp'))).toBe(false);
    expect(isRasterImage(f('scan.tiff'))).toBe(false);
    // a contradicting name wins over the MIME
    expect(isRasterImage(f('notes.txt', 'image/png'))).toBe(false);
  });

  it('isInlineVideo: .ts reported as video/mp2t is source code', () => {
    expect(isInlineVideo(f('clip.mp4', 'video/mp4'))).toBe(true);
    expect(isInlineVideo(f('clip.mov'))).toBe(true);
    expect(isInlineVideo(f('types.ts', 'video/mp2t'))).toBe(false);
    expect(isInlineVideo(f('movie.mkv', 'video/x-matroska'))).toBe(false);
  });

  it('uploadContentTypeFor declares the extension’s type only when the OS gave none', () => {
    expect(uploadContentTypeFor(f('a.png'))).toBe('image/png');
    expect(uploadContentTypeFor(f('a.py'))).toBe('application/octet-stream');
    expect(uploadContentTypeFor(f('a.py', 'text/x-python-script'))).toBe('text/x-python-script');
  });
});

describe('key regexes widen in lockstep with what storage writes', () => {
  const NANO = 'V1StGXR8_Z5jdHi6B-myT';

  it('accept 1–10 char extensions, reject uppercase / traversal / missing extension', () => {
    for (const ok of [`file/${NANO}.c`, `file/${NANO}.properties`, `file/${NANO}.bin`, `file/${NANO}.gz`, `file/${NANO}.ipynb`]) {
      expect(ZONE_MEDIA_KEY_RE.test(ok)).toBe(true);
      expect(EMBED_FILE_KEY_RE.test(ok)).toBe(true);
      expect(parseEmbedToken(`[embed:file:${ok}]`)).toEqual({ kind: 'file', ref: ok });
    }
    for (const bad of [`file/${NANO}`, `file/${NANO}.`, `file/${NANO}.PDF`, `file/../x.pdf`, `file/${NANO}.abcdefghijk`, `file/a.b/c.pdf`, `file/${NANO}.p-y`]) {
      expect(ZONE_MEDIA_KEY_RE.test(bad)).toBe(false);
      expect(isEmbedFileKey(bad)).toBe(false);
    }
  });

  it('every key the file kind can write passes both regexes', () => {
    const names = ['main.py', 'a.c', 'build.properties', 'Makefile', 'data.tar.gz', '.env', 'x.averyverylongext', '../../x', '报告.DOCX', 'shot.svg', 'page.html'];
    for (const name of names) {
      for (const mime of ['', 'application/octet-stream', 'text/html', 'image/svg+xml', 'application/pdf']) {
        const key = newZoneMediaKey('file', zoneMediaExtFor('file', mime, name));
        expect(isValidZoneMediaKey(key, 'file')).toBe(true);
        expect(isEmbedFileKey(key)).toBe(true);
      }
    }
  });

  it('media kinds stay clamped to their inline sets', () => {
    expect(zoneMediaExtFor('image', 'image/png', 'x.svg')).toBe('png');
    expect(zoneMediaExtFor('video', 'video/quicktime', 'x.mov')).toBe('mov');
    expect(zoneMediaExtFor('poster', '', 'x.html')).toBe('jpg');
    expect(zoneMediaExtFor('file', 'text/html', 'page.html')).toBe('html'); // stored as html, SERVED as text/plain
  });
});
