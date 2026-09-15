// Regression: re-editing a post must not silently drop — and then unlink — an
// attachment whose storage key the client-side key regex rejects. The old
// `[a-z0-9]{2,5}` extension rejected `.c`, `.r`, `.properties` — keys the
// any-file upload now writes — so `draftFromView` would return null for them, the
// composer's ledger lost the row, and `updateZonePost` replaced the attachment
// set wholesale and deleted the file. This walks the REAL chain:
// storage ext → key → row view → composer draft → save payload → server resolve.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZONE_MEDIA_KEY_RE } from '@/lib/zones/shared';

const db = vi.hoisted(() => ({
  zonePost: { findUnique: vi.fn(async () => null) },
  zonePostAttachment: {
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  },
}));
const disk = vi.hoisted(() => ({ files: new Map<string, number>() }));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/zones/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/zones/storage')>();
  return {
    ...real,
    statZoneMediaAsync: vi.fn(async (key: string) => {
      const size = disk.files.get(key);
      return size === undefined ? null : { size, contentType: real.zoneMediaContentType(key) };
    }),
    deleteZoneMediaFile: vi.fn(),
  };
});
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/queries', () => ({ readableZoneWhere: vi.fn(() => ({})), zoneOrgTree: vi.fn() }));

import { attachmentPayload, classify, draftFromView } from '@/components/zones/attachments/upload-core';
import { isRasterImage } from '@/lib/files/file-types';
import { attachmentPreviewBadgeKey } from '@/components/zones/attachments/preview-badge';
import { resolvePostAttachments, toAttachmentView } from '@/lib/zones/post-queries';
import { newZoneMediaKey, zoneMediaExtFor, zoneMediaPublicUrl } from '@/lib/zones/storage';

const LEGACY_KEY_RE = /^(image|video|file|cover|icon|poster|preview)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;

function savedRow(name: string, mimeType = '') {
  const key = newZoneMediaKey('file', zoneMediaExtFor('file', mimeType, name));
  disk.files.set(key, 42);
  return {
    id: `row-${key}`,
    kind: 'file' as const,
    key,
    url: zoneMediaPublicUrl(key),
    name,
    mimeType,
    sizeBytes: 42,
    width: null,
    height: null,
    posterUrl: null,
    previewStatus: 'unsupported' as const,
    previewUrl: null,
  };
}

beforeEach(() => {
  disk.files.clear();
  vi.clearAllMocks();
});

describe('re-editing a post keeps every attachment the upload route can write', () => {
  const NAMES = ['kernel.c', 'gradle.properties', 'plot.r', 'analysis.ipynb', 'Makefile', 'dataset.tar.gz', 'page.html', 'logo.svg', 'setup.exe'];

  it('draftFromView keeps long-extension and extension-less keys the old regex dropped', () => {
    const rows = NAMES.map((n) => savedRow(n));
    const dropped = rows.filter((r) => !LEGACY_KEY_RE.test(r.key)).map((r) => r.name);
    // the regression is real: these are exactly the rows the old composer lost
    expect(dropped).toEqual(['kernel.c', 'gradle.properties', 'plot.r']);
    for (const row of rows) {
      expect(ZONE_MEDIA_KEY_RE.test(row.key)).toBe(true);
      const draft = draftFromView(toAttachmentView(row));
      expect(draft, row.name).not.toBeNull();
      expect(draft!.key).toBe(row.key);
    }
  });

  it('the re-saved ledger resolves server-side with the same keys (nothing to unlink)', async () => {
    const rows = NAMES.map((n) => savedRow(n));
    const drafts = rows.map((r) => draftFromView(toAttachmentView(r))!);
    const resolved = await resolvePostAttachments(attachmentPayload(drafts), '', { excludePostId: 'p1' });
    expect(resolved.map((a) => a.key)).toEqual(rows.map((r) => r.key));
    expect(resolved.map((a) => a.ext)).toEqual(['c', 'properties', 'r', 'ipynb', '', 'tar.gz', 'html', 'svg', 'exe']);
    // preview status comes from the KEY: nothing here is an office file
    expect(resolved.every((a) => a.previewStatus === 'unsupported')).toBe(true);
  });

  it('office conversion is decided by the key, not a name that lies', async () => {
    const lying = savedRow('slides.pptx');
    // the name says pptx and the key agrees → pending
    const [ok] = await resolvePostAttachments([{ key: lying.key, name: 'slides.pptx', mimeType: '', sizeBytes: 0 }], '');
    expect(ok.previewStatus).toBe('pending');
    // a txt key renamed to .pptx in the payload is NOT queued for soffice
    const txt = savedRow('notes.txt');
    const [renamed] = await resolvePostAttachments([{ key: txt.key, name: 'deck.pptx', mimeType: '', sizeBytes: 0 }], '');
    expect(renamed.previewStatus).toBe('unsupported');
    expect(renamed.ext).toBe('pptx'); // display only
  });
});

describe('badges agree with the preview panel', () => {
  const view = (name: string) => toAttachmentView(savedRow(name));

  it('text, code and data files are previewable; archives and binaries are download-only', () => {
    expect(attachmentPreviewBadgeKey(view('main.py'))).toBe('attach_previewable');
    expect(attachmentPreviewBadgeKey(view('rows.csv'))).toBe('attach_previewable');
    expect(attachmentPreviewBadgeKey(view('page.html'))).toBe('attach_previewable'); // as source
    expect(attachmentPreviewBadgeKey(view('bundle.zip'))).toBe('attach_download_only');
    expect(attachmentPreviewBadgeKey(view('setup.exe'))).toBe('attach_download_only');
    expect(attachmentPreviewBadgeKey(view('LICENSE'))).toBeNull(); // sniffed at open, no promise
  });

  it('office badges follow the conversion state', () => {
    const row = { ...savedRow('deck.pptx'), previewStatus: 'pending' as const };
    expect(attachmentPreviewBadgeKey(toAttachmentView(row))).toBe('attach_preview_pending');
    expect(attachmentPreviewBadgeKey(toAttachmentView({ ...row, previewStatus: 'ready' }))).toBe('attach_previewable');
  });
});

describe('client classification — every file is attachable', () => {
  const file = (name: string, type = '') => ({ name, type }) as File;

  it('raster images and inline video by extension first; everything else is a file', () => {
    expect(classify(file('a.png', 'image/png'))).toBe('image');
    expect(classify(file('a.png'))).toBe('image');
    expect(classify(file('clip.mp4', 'video/mp4'))).toBe('video');
    expect(classify(file('types.ts', 'video/mp2t'))).toBe('file');
    expect(classify(file('logo.svg', 'image/svg+xml'))).toBe('file');
    expect(classify(file('photo.heic', 'image/heic'))).toBe('file');
    expect(classify(file('main.py', 'text/x-python-script'))).toBe('file');
    expect(classify(file('Makefile'))).toBe('file');
    expect(classify(file('setup.exe', 'application/x-msdownload'))).toBe('file');
  });

  it('isRasterImage routes svg / heic / bmp / tiff away from the editor image path', () => {
    expect(isRasterImage(file('a.jpg', 'image/jpeg'))).toBe(true);
    for (const [n, t] of [
      ['a.svg', 'image/svg+xml'],
      ['a.heic', 'image/heic'],
      ['a.bmp', 'image/bmp'],
      ['a.tiff', 'image/tiff'],
    ]) {
      expect(isRasterImage(file(n, t))).toBe(false);
    }
  });
});
