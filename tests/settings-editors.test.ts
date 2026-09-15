import { describe, expect, it, vi } from 'vitest';
import { profileMediaExtFor } from '@/lib/profile/card-media-storage';

// card-media-storage reads env (upload-key signing) at import; only its pure
// `profileMediaExtFor` is used here, to pin the client pre-check to the route.
vi.mock('@/lib/env', () => ({ env: { AUTH_SECRET: 'settings-editors-test' } }));
import {
  STRIP_MAX_EDGE,
  addInterests,
  bytesToMb,
  cardConfigsEqual,
  cardEffectsFor,
  cardMediaErrorKey,
  checkCardFile,
  codePointLength,
  fitLongEdge,
  layoutsEqual,
  linkRowState,
  linksForSave,
  mediaFormatOf,
  moveItem,
  resetCardLook,
  shouldStripImage,
  splitInterestInput,
  strippedFileName,
  toggleSectionHidden,
} from '@/app/settings/_components/editor-shared';
import {
  DEFAULT_CARD_CONFIG,
  MAX_INTERESTS,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_SECTIONS,
  PROFILE_VIDEO_MAX_BYTES,
  defaultProfileLayout,
  parseCardConfig,
} from '@/lib/profile/shared';

describe('moveItem', () => {
  it('moves within bounds and ignores out-of-range targets', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c']);
  });
  it('never mutates the input', () => {
    const src = ['a', 'b'] as const;
    const out = moveItem(src, 0, 1);
    expect(src).toEqual(['a', 'b']);
    expect(out).not.toBe(src);
  });
});

describe('codePointLength', () => {
  it('counts code points like the server caps do', () => {
    expect(codePointLength('名片')).toBe(2);
    expect(codePointLength('😀a')).toBe(2);
    expect(codePointLength('𠮷')).toBe(1);
  });
});

describe('兴趣标签', () => {
  it('splits on ASCII / fullwidth commas, 顿号, semicolons and newlines', () => {
    expect(splitInterestInput('RAG, Agent、评测；多模态\nLLM')).toEqual(['RAG', 'Agent', '评测', '多模态', 'LLM']);
    expect(splitInterestInput(' , ，')).toEqual([]);
  });

  it('adds through sanitizeInterests (leading # stripped, trimmed)', () => {
    expect(addInterests([], '#RAG,  Agent ').next).toEqual(['RAG', 'Agent']);
  });

  it('reports a case-insensitive duplicate instead of adding it', () => {
    const r = addInterests(['RAG'], 'rag');
    expect(r.next).toEqual(['RAG']);
    expect(r.duplicate).toBe('RAG');
    expect(r.full).toBe(false);
  });

  it('reports full when the cap refused a new tag', () => {
    const current = Array.from({ length: MAX_INTERESTS }, (_, i) => `t${i}`);
    const r = addInterests(current, 'new');
    expect(r.next).toHaveLength(MAX_INTERESTS);
    expect(r.full).toBe(true);
    // A duplicate typed into a full list is a duplicate, not "full".
    expect(addInterests(current, 'T0').full).toBe(false);
  });
});

describe('外链 rows', () => {
  it('classifies blank / valid / invalid rows', () => {
    expect(linkRowState({ label: '', url: '   ' })).toBe('empty');
    expect(linkRowState({ label: '', url: 'https://github.com/x' })).toBe('valid');
    expect(linkRowState({ label: 'x', url: '' })).toBe('invalid');
    expect(linkRowState({ label: '', url: 'javascript:alert(1)' })).toBe('invalid');
    expect(linkRowState({ label: '', url: '//evil.example' })).toBe('invalid');
  });

  it('drops blank rows, keeps order, and lists the ids that block a save', () => {
    const r = linksForSave([
      { id: 'a', label: 'GitHub', url: 'https://github.com/me' },
      { id: 'b', label: '', url: '' },
      { id: 'c', label: '', url: 'ftp://x' },
      { id: 'd', label: '', url: 'https://www.example.com/blog' },
    ]);
    expect(r.invalidIds).toEqual(['c']);
    expect(r.links).toEqual([
      { label: 'GitHub', url: 'https://github.com/me' },
      // label defaults to the hostname — the server's own rule
      { label: 'www.example.com', url: 'https://www.example.com/blog' },
    ]);
  });
});

describe('名片 draft helpers', () => {
  it('compares configs after parsing (garbage vs defaults is equal)', () => {
    expect(cardConfigsEqual({}, DEFAULT_CARD_CONFIG)).toBe(true);
    expect(cardConfigsEqual({ style: 'nope' }, { style: 'holo' })).toBe(true);
    expect(cardConfigsEqual({ theme: '#ABCDEF' }, { theme: 'abcdef' })).toBe(true);
    expect(cardConfigsEqual({ blur: 3 }, { blur: 4 })).toBe(false);
  });

  it('resetCardLook keeps the words and restores the look', () => {
    const card = parseCardConfig({ style: 'reflective', theme: '#112233', status: '在温哥华', label: 'LAB', tilt: false, blur: 3 });
    const reset = resetCardLook(card, DEFAULT_CARD_CONFIG);
    expect(reset).toEqual({ ...DEFAULT_CARD_CONFIG, status: '在温哥华', label: 'LAB' });
  });

  it('exposes only the effect controls a style uses', () => {
    expect(cardEffectsFor('holo')).toEqual({ tilt: true, pattern: true, mediaTone: true, reflective: false, label: false });
    expect(cardEffectsFor('reflective')).toEqual({ tilt: true, pattern: false, mediaTone: false, reflective: true, label: true });
    expect(cardEffectsFor('minimal')).toEqual({ tilt: false, pattern: false, mediaTone: false, reflective: false, label: false });
  });

  it('pre-checks card media against the route allowlist and caps', () => {
    expect(checkCardFile({ type: 'image/png', size: 10 })).toEqual({ ok: true, kind: 'image', ext: 'png', maxBytes: PROFILE_IMAGE_MAX_BYTES });
    expect(checkCardFile({ type: 'video/quicktime', size: 10 })).toMatchObject({ ok: true, kind: 'video' });
    expect(checkCardFile({ type: 'image/svg+xml', size: 10 })).toMatchObject({ ok: false, error: 'unsupported_type' });
    expect(checkCardFile({ type: 'video/mp4', size: 0 })).toMatchObject({ ok: false, error: 'empty' });
    expect(checkCardFile({ type: 'video/mp4', size: PROFILE_VIDEO_MAX_BYTES + 1 })).toMatchObject({
      ok: false,
      error: 'file_too_large',
      maxBytes: PROFILE_VIDEO_MAX_BYTES,
    });
    expect(bytesToMb(PROFILE_IMAGE_MAX_BYTES)).toBe(10);
  });

  it('falls back to the extension ONLY for a generic type, like the upload route', () => {
    expect(checkCardFile({ type: '', size: 10, name: 'clip.MOV' })).toMatchObject({ ok: true, kind: 'video', ext: 'mov' });
    expect(checkCardFile({ type: 'application/octet-stream', size: 10, name: 'me.jpeg' })).toMatchObject({
      ok: true,
      kind: 'image',
      ext: 'jpg',
    });
    expect(checkCardFile({ type: '', size: 10, name: 'a.m4v' })).toMatchObject({ ok: true, kind: 'video', ext: 'mp4' });
    // A friendly name never rescues a declared non-allowlisted type.
    expect(checkCardFile({ type: 'image/svg+xml', size: 10, name: 'x.png' })).toMatchObject({ ok: false, error: 'unsupported_type' });
    expect(checkCardFile({ type: '', size: 10, name: 'x.svg' })).toMatchObject({ ok: false, error: 'unsupported_type' });
    expect(checkCardFile({ type: '', size: 10 })).toMatchObject({ ok: false, error: 'unsupported_type' });
    expect(checkCardFile({ type: '', size: PROFILE_VIDEO_MAX_BYTES + 1, name: 'big.webm' })).toMatchObject({
      ok: false,
      error: 'file_too_large',
    });
  });

  it('classifies every file exactly as profileMediaExtFor stores it (no client/server drift)', () => {
    const types = ['', 'application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'image/svg+xml', 'text/html', 'image/heic'];
    const names = ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.avif', 'a.gif', 'a.mp4', 'a.m4v', 'a.webm', 'a.mov', 'a.svg', 'a.html', 'a.heic', 'noext'];
    for (const type of types) {
      for (const name of names) {
        const client = mediaFormatOf({ type, name });
        const image = profileMediaExtFor('image', type, name);
        const video = profileMediaExtFor('video', type, name);
        const server = image ? { kind: 'image', ext: image } : video ? { kind: 'video', ext: video } : null;
        expect({ type, name, format: client }).toEqual({ type, name, format: server });
      }
    }
  });

  it('maps every upload/media error code to a message key (unknown → generic)', () => {
    expect(cardMediaErrorKey('file_too_large')).toBe('ce_err_too_large');
    expect(cardMediaErrorKey('media_claimed')).toBe('ce_err_claimed');
    expect(cardMediaErrorKey('bad_kind')).toBe('ce_err_unsupported');
    expect(cardMediaErrorKey('whatever')).toBe('ce_err_upload_failed');
  });
});

describe('照片去元数据 (pure half)', () => {
  it('re-encodes every still format but leaves GIF animation alone', () => {
    for (const ext of ['jpg', 'png', 'webp', 'avif']) expect(shouldStripImage(ext)).toBe(true);
    expect(shouldStripImage('gif')).toBe(false);
  });

  it('caps the long edge without upscaling or collapsing to 0', () => {
    expect(fitLongEdge(4032, 3024)).toEqual({ width: STRIP_MAX_EDGE, height: 1536 });
    expect(fitLongEdge(3024, 4032)).toEqual({ width: 1536, height: STRIP_MAX_EDGE });
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(20000, 10)).toEqual({ width: STRIP_MAX_EDGE, height: 1 });
    expect(fitLongEdge(0, 0)).toEqual({ width: 1, height: 1 });
    expect(fitLongEdge(3000, 1000, 300)).toEqual({ width: 300, height: 100 });
  });

  it('names the upload after the encoder output type', () => {
    expect(strippedFileName('IMG_2041.HEIC.jpeg', 'image/webp')).toBe('IMG_2041.HEIC.webp');
    expect(strippedFileName('me.png', 'image/jpeg')).toBe('me.jpg');
    expect(strippedFileName('.png', 'image/webp')).toBe('photo.webp');
    expect(strippedFileName('noext', 'image/webp')).toBe('noext.webp');
  });
});

describe('主页板块 layout helpers', () => {
  it('toggles hidden and keeps it in catalog order', () => {
    let l = defaultProfileLayout();
    l = toggleSectionHidden(l, 'shelf');
    l = toggleSectionHidden(l, 'skills');
    expect(l.hidden).toEqual(['skills', 'shelf']);
    l = toggleSectionHidden(l, 'shelf');
    expect(l.hidden).toEqual(['skills']);
    expect(l.order).toEqual([...PROFILE_SECTIONS]);
  });

  it('compares order strictly and hidden as a set', () => {
    const a = { order: [...PROFILE_SECTIONS], hidden: ['docs', 'posts'] as const };
    const b = { order: [...PROFILE_SECTIONS], hidden: ['posts', 'docs'] as const };
    expect(layoutsEqual({ ...a, hidden: [...a.hidden] }, { ...b, hidden: [...b.hidden] })).toBe(true);
    expect(layoutsEqual(defaultProfileLayout(), { order: moveItem(PROFILE_SECTIONS, 0, 1), hidden: [] })).toBe(false);
  });
});
