// How a stored file is DESCRIBED on every surface — lib/files/display.ts — and
// the leftovers of the any-file refactor that made it the only description:
//   - an extension-less upload (`LUXMAKEFILE` → a `.bin` key) showed the raw
//     client MIME `application/octet-stream` on the zone cards, uppercased and
//     wrapped onto two lines in the post rail;
//   - the 讨论区 card said "2 KB" for a 1,536-byte file while the drawer it opened
//     said "1.5 KB" (two byte formatters), and the `?name=` download rule was
//     hand-written five times;
//   - classify() had become total but kept `| null`, which left unreachable
//     branches in its callers; upload-core carried pass-through aliases of
//     file-types decisions; `discussion_ui.click_download` outlived its only use.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';
import { fileDownloadHref, fileMetaParts, formatBytes } from '@/lib/files/display';
import { formatBytes as zoneFormatBytes } from '@/lib/zones/shared';
import * as discussionTypes from '@/app/discussion/_components/types';
import { fileMetaLabel } from '@/components/files/FileViewer';
import { AttachmentCard } from '@/components/zones/attachments/AttachmentCard';
import { describeEmbed } from '@/components/zones/embeds/EmbedCard';
import * as uploadCore from '@/components/zones/attachments/upload-core';
import type { UploadKind } from '@/components/zones/attachments/upload-core';
import { INLINE_VIDEO_MIMES, extFromMime } from '@/lib/files/file-types';
import { isAllowedPostVideoType, postMediaExtFor } from '@/lib/uploads/post-media-keys';
import type { EmbedFileData, ZoneAttachmentView } from '@/lib/zones/types';

const ROOT = join(__dirname, '..');

/** The LUXMAKEFILE row exactly as upload-core `draftFromUpload` / post-queries `toAttachmentView` build it. */
const noExtRow: ZoneAttachmentView = {
  id: 'att1',
  kind: 'file',
  url: '/api/zones/media/file/abcdef.bin',
  name: 'LUXMAKEFILE',
  mimeType: 'application/octet-stream',
  sizeBytes: 14,
  width: null,
  height: null,
  posterUrl: null,
  ext: '',
  previewStatus: 'none',
  previewUrl: null,
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** app / components / lib sources, read once for both source scans (they walk ~2k files). */
let sources: { path: string; text: string }[] | null = null;
function appSources(): { path: string; text: string }[] {
  sources ??= ['app', 'components', 'lib'].flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  return sources;
}
/** Generous: a cold file walk on a loaded machine is seconds, not the default 5 s budget. */
const SCAN = { timeout: 60_000 };

describe('formatBytes — one formatter for the card and the viewer it opens', () => {
  it('formats with one decimal under 10 and whole numbers above', () => {
    expect(formatBytes(14)).toBe('14 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('the zone re-export IS the shared function, and 讨论区 keeps no copy', () => {
    expect(zoneFormatBytes).toBe(formatBytes);
    expect('formatBytes' in discussionTypes).toBe(false);
  });

  it('a 讨论区 card meta and its drawer header say the same size', () => {
    const card = fileMetaParts('pdf', 1536, 'FILE').join(' · ');
    expect(card).toBe('PDF · 1.5 KB');
    expect(fileMetaLabel('spec.pdf', 'file/x.pdf', 1536, 'FILE')).toBe(card);
  });
});

describe('fileMetaParts — the EXT slot never shows a MIME type', () => {
  it('an extension-less file gets the localized generic label', () => {
    expect(fileMetaParts('', 14, '文件')).toEqual(['文件', '14 B']);
    expect(fileMetaParts(null, 14, 'FILE')).toEqual(['FILE', '14 B']);
    expect(fileMetaParts('tar.gz', 2048, 'FILE')).toEqual(['TAR.GZ', '2.0 KB']);
  });

  it('an unknown size (0 on a legacy row) is omitted rather than "0 B"', () => {
    expect(fileMetaParts('py', 0, 'FILE')).toEqual(['PY']);
    expect(fileMetaParts('py', null, 'FILE')).toEqual(['PY']);
  });

  it('the body embed card of an extension-less upload shows 文件, not application/octet-stream', () => {
    const data: EmbedFileData = { ...noExtRow, postId: 'p1', zoneSlug: 'z' };
    const t = (key: string) => (key === 'attach_type_generic' ? 'FILE' : key);
    const model = describeEmbed({ kind: 'file', ref: 'att1', ok: true, data }, t, (k) => k);
    expect(model.meta).toEqual(['FILE', '14 B']);
    expect(model.meta.join(' ')).not.toMatch(/octet-stream/i);
  });

  it('the ledger / rail card renders the generic label, never the MIME (server render)', () => {
    for (const [locale, messages, label] of [
      ['en', en, 'FILE'],
      ['zh-CN', zhCN, '文件'],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(NextIntlClientProvider, { locale, messages, children: createElement(AttachmentCard, { attachment: noExtRow }) }),
      );
      expect(html, locale).not.toMatch(/octet-stream/i);
      expect(html, locale).toContain(`<span>${label}</span>`);
      expect(html, locale).toContain('<span>14 B</span>');
    }
  });
});

describe('fileDownloadHref — the only builder of a 下载 link', () => {
  it('encodes the display name and falls back to "attachment"', () => {
    expect(fileDownloadHref('/api/zones/media/file/a.py', '模型 v2.py')).toBe(`/api/zones/media/file/a.py?name=${encodeURIComponent('模型 v2.py')}`);
    expect(fileDownloadHref('/api/zones/media/file/a.py', '')).toBe('/api/zones/media/file/a.py?name=attachment');
  });

  it('no surface hand-writes the `?name=${encodeURIComponent(...)}` rule again', SCAN, () => {
    const offenders = appSources()
      .filter(({ path }) => !path.endsWith(join('lib', 'files', 'display.ts')))
      .filter(({ text }) => /\?name=\$\{encodeURIComponent\(/.test(text))
      .map(({ path }) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

describe('post video MIME table is the file-types one', () => {
  it('admits exactly the inline video set and writes its extension', () => {
    for (const mime of INLINE_VIDEO_MIMES) {
      expect(isAllowedPostVideoType(mime)).toBe(true);
      expect(postMediaExtFor('video', mime, 'clip')).toBe(extFromMime(mime));
    }
    expect(isAllowedPostVideoType('audio/mp4')).toBe(false);
  });

  it('keeps no local MIME → extension copy', () => {
    const src = readFileSync(join(ROOT, 'lib/uploads/post-media-keys.ts'), 'utf8');
    expect(src).not.toMatch(/'video\/(mp4|webm|quicktime)'/);
  });
});

describe('dead code after the any-file change', () => {
  it('classify() is total — its type has no null for callers to handle', () => {
    // Compile-time half: `pnpm typecheck` fails if the return type widens again.
    expectTypeOf(uploadCore.classify).returns.toEqualTypeOf<UploadKind>();
    expect(uploadCore.classify({ name: 'LUXMAKEFILE', type: '' } as File)).toBe('file');
  });

  it('upload-core carries no second name for a file-types decision', () => {
    expect(Object.keys(uploadCore)).not.toContain('isRasterImageFile');
    expect(Object.keys(uploadCore)).not.toContain('uploadContentType');
  });

  it('every attachment / discussion UI message key is still referenced by code', SCAN, () => {
    const tokens = new Set(appSources().flatMap(({ text }) => text.match(/[A-Za-z0-9_]+/g) ?? []));
    const keys = [
      ...Object.keys(zhCN.discussion_ui).map((k) => `discussion_ui.${k}`),
      ...Object.keys(zhCN.zones)
        .filter((k) => k.startsWith('attach_'))
        .map((k) => `zones.${k}`),
    ];
    expect(keys.filter((k) => !tokens.has(k.split('.')[1]))).toEqual([]);
  });
});
