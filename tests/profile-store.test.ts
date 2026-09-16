// 个人主页与名片 — the pure write planners (lib/profile/profile-store.ts), the
// card view decisions (lib/profile/card-view.ts), the clip route's input/range
// planning and its refusals that come before any query, and badge assembly
// (lib/profile/badges.ts).
//
// The DB is mocked away: everything pinned here is a decision that must hold
// before a query ever runs (the clip route's render wiring is pinned against
// FAKE ffmpeg/ffprobe scripts that log their argv and fail the encode, so the
// request ends at 500 before the attach transaction would need a database) — what a PUT body may become, which avatar/banner
// URLs are accepted, which sections a viewer's card figures may count, what a
// card plays, and that a staff role can never become a badge.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP_STORAGE = vi.hoisted(() => {
  // Before any import: image-storage resolves the uploads root from this at load,
  // so the clip-route test below writes its fixture outside the dev box's storage.
  process.env.LOCAL_STORAGE_DIR = `/tmp/aic-profile-store-test-${process.pid}`;
  return `/tmp/aic-profile-store-test-${process.pid}`;
});
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/env', () => ({ env: { AUTH_SECRET: 'test-secret-test-secret-0123456789' } }));

import {
  CLIP_IN_PROGRESS_RETRY_AFTER_SEC,
  clipOwnCardVideo,
  decideImageUrl,
  droppedMediaKeys,
  isSafeExternalImageUrl,
  isUploadedImageUrl,
  normalizeHostname,
  parseCardClipInput,
  parseCardMediaInput,
  planCardClip,
  planOrphanSweep,
  planProfileWrite,
  selfHostnames,
  urlPathHasApiSegment,
} from '@/lib/profile/profile-store';
import { newProfileMediaKey, ownerTagFor, profileMediaAbsPath, profileMediaOwnerTag } from '@/lib/profile/card-media-storage';
import { decideCardMedia, ownCardClip, pickCardStats, profileSectionAllowed } from '@/lib/profile/card-view';
import { setMediaToolBinaries } from '@/lib/media/ffmpeg';
import { parseStoredClip } from '@/lib/media/clip-shared';
import { assembleBadges, roleBadge, roleBadgeKey } from '@/lib/profile/badges';
import { toPublicUserTag } from '@/lib/user-tags';
import { publicRoleBadge } from '@/lib/permissions';
import {
  ABOUT_MAX,
  DEFAULT_CARD_CONFIG,
  PROFILE_CLIP_MAX_SECONDS,
  HEADLINE_MAX,
  PROFILE_SECTIONS,
  defaultProfileLayout,
  parseProfileLayout,
} from '@/lib/profile/shared';

const IMG = '/api/uploads/images/V1StGXR8_Z5jdHi6B-myT.png';

describe('isUploadedImageUrl / isSafeExternalImageUrl', () => {
  it('accepts exactly the editor uploader URL shape', () => {
    expect(isUploadedImageUrl(IMG)).toBe(true);
    expect(isUploadedImageUrl('/api/uploads/images/V1StGXR8_Z5jdHi6B-myT.jpg')).toBe(true);
    for (const v of [
      '/api/uploads/stickers/V1StGXR8_Z5jdHi6B-myT.gif',
      '/api/uploads/images/../../x.png',
      '/api/uploads/images/V1StGXR8_Z5jdHi6B-myT.svg',
      '/api/uploads/images/short.png',
      '/anything',
      'https://example.com/a.png',
      `${IMG}?x=1`,
    ]) {
      expect(isUploadedImageUrl(v)).toBe(false);
    }
  });

  it('accepts clean http(s) URLs and nothing that could break out of an attribute or url()', () => {
    expect(isSafeExternalImageUrl('https://w3.example.com/avatar/123.png?sig=abc')).toBe(true);
    expect(isSafeExternalImageUrl('http://10.0.0.1/a.jpg')).toBe(true);
    for (const v of [
      'javascript:alert(1)',
      '//evil.example/a.png',
      'data:image/png;base64,AAAA',
      'https://user:pw@example.com/a.png',
      'https://example.com/a b.png',
      'https://example.com/a".png',
      "https://example.com/a').png",
      `https://example.com/${String.fromCharCode(0)}a.png`,
      'https://example.com/a\\b.png',
      `https://example.com/${'a'.repeat(2100)}`,
    ]) {
      expect(isSafeExternalImageUrl(v)).toBe(false);
    }
  });
});

describe('decideImageUrl', () => {
  it('clears on null / empty / whitespace', () => {
    expect(decideImageUrl(null, IMG, { allowExternal: false })).toEqual({ ok: true, value: null, changed: true });
    expect(decideImageUrl('', IMG, { allowExternal: false })).toEqual({ ok: true, value: null, changed: true });
    expect(decideImageUrl('  ', null, { allowExternal: false })).toEqual({ ok: true, value: null, changed: false });
  });

  it('keeps an unchanged legacy value working as a no-op', () => {
    // Accepted by the pre-guard rule (any `/…`), refused as a NEW value.
    expect(decideImageUrl('/legacy/avatar.png', '/legacy/avatar.png', { allowExternal: false })).toEqual({
      ok: true,
      value: '/legacy/avatar.png',
      changed: false,
    });
    expect(decideImageUrl('/legacy/other.png', '/legacy/avatar.png', { allowExternal: true })).toEqual({ ok: false });
  });

  it('accepts uploader URLs; external URLs only when allowed', () => {
    expect(decideImageUrl(IMG, null, { allowExternal: false })).toEqual({ ok: true, value: IMG, changed: true });
    const ext = 'https://cdn.example.com/a.png';
    expect(decideImageUrl(ext, null, { allowExternal: false })).toEqual({ ok: false });
    expect(decideImageUrl(ext, null, { allowExternal: true })).toEqual({ ok: true, value: ext, changed: true });
  });

  it('refuses non-strings', () => {
    expect(decideImageUrl(42, null, { allowExternal: true })).toEqual({ ok: false });
    expect(decideImageUrl({}, null, { allowExternal: true })).toEqual({ ok: false });
  });

  it("refuses an external URL on the app's own host (an <img> there carries the viewer's session)", () => {
    const blockedHosts = ['cari.rnd.huawei.com', 'localhost'];
    const opts = { allowExternal: true, blockedHosts };
    for (const v of [
      'https://cari.rnd.huawei.com/ai-community/api/skills/x/raw',
      'https://CARI.rnd.huawei.com/ai-community/api/skills/x/raw',
      'https://cari.rnd.huawei.com./ai-community/api/skills/x/raw',
      // Cookies ignore port and scheme, so neither is a way around the rule.
      'http://cari.rnd.huawei.com:8443/ai-community/api/skills/x/raw',
      'http://localhost:3000/api/skills/x/raw',
    ]) {
      expect(decideImageUrl(v, null, opts)).toEqual({ ok: false });
    }
    expect(decideImageUrl('https://w3.example.com/a.png', null, opts)).toMatchObject({ ok: true, changed: true });
    // The uploader's own root-relative URL is not an external URL at all.
    expect(decideImageUrl(IMG, null, opts)).toEqual({ ok: true, value: IMG, changed: true });
    // A value already stored stays a no-op, even on the blocked host.
    const stored = 'https://cari.rnd.huawei.com/old.png';
    expect(decideImageUrl(stored, stored, opts)).toEqual({ ok: true, value: stored, changed: false });
  });

  it('refuses an external URL into any /api/ path, on ANY host (alias hosts 301 to the app with cookies)', () => {
    // The denylist only knows the hosts the request and config name; ai4news is
    // an alias that nginx 301s to cari inside /ai-community/, and the Lax session
    // cookie follows an <img> across that same-site redirect.
    const opts = { allowExternal: true, blockedHosts: ['cari.rnd.huawei.com'] };
    for (const v of [
      'https://ai4news.rnd.huawei.com/ai-community/api/skills/x/raw',
      'http://127.0.0.1:3000/api/skills/x/raw',
      'http://[::1]:3000/api/skills/x/raw',
      'http://0x7f.0.0.1:3000/api/skills/x/raw',
      'https://alias.example/API/skills/x/raw',
      'https://alias.example/ai-community/%61pi/skills/x/raw',
      'https://alias.example/ai-community/%2561pi/skills/x/raw',
      'https://alias.example/ai-community%2Fapi%2Fskills/x/raw',
      'https://alias.example/ai-community/api;v=1/skills/x/raw',
      'https://alias.example/x/../api/skills/x/raw',
      'https://alias.example/api',
    ]) {
      expect(decideImageUrl(v, null, opts)).toEqual({ ok: false });
    }
    // The bytes "api" elsewhere are fine: in a longer segment, a host or a query.
    for (const v of [
      'https://w3.example.com/apis/avatar.png',
      'https://w3.example.com/rapid/avatar.png',
      'https://api.example.com/avatar/1.png',
      'https://w3.example.com/avatar.png?from=/api/x',
    ]) {
      expect(decideImageUrl(v, null, opts)).toMatchObject({ ok: true, changed: true });
    }
    // Stored values written before the rule still save untouched.
    const stored = 'https://ai4news.rnd.huawei.com/ai-community/api/skills/x/raw';
    expect(decideImageUrl(stored, stored, opts)).toEqual({ ok: true, value: stored, changed: false });
  });
});

describe('urlPathHasApiSegment', () => {
  it('finds the segment through encoding, separators and case; treats an undecodable path as one', () => {
    expect(urlPathHasApiSegment('https://h/api/x')).toBe(true);
    expect(urlPathHasApiSegment('https://h/a/b/Api')).toBe(true);
    expect(urlPathHasApiSegment('https://h/a%5Capi%5Cx')).toBe(true);
    expect(urlPathHasApiSegment('https://h/%E0%A4%A')).toBe(true);
    expect(urlPathHasApiSegment('not a url')).toBe(true);
    expect(urlPathHasApiSegment('https://h/avatars/api.png')).toBe(false);
    expect(urlPathHasApiSegment('https://h/')).toBe(false);
  });
});

describe('selfHostnames / normalizeHostname', () => {
  it('normalizes Host headers and URLs to a bare lower-case hostname', () => {
    expect(normalizeHostname('Example.COM:3000')).toBe('example.com');
    expect(normalizeHostname('https://cari.rnd.huawei.com/ai-community/api/auth')).toBe('cari.rnd.huawei.com');
    expect(normalizeHostname('example.com.')).toBe('example.com');
    expect(normalizeHostname('[::1]:3000')).toBe('[::1]');
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname('http://')).toBeNull();
  });

  it('collects Host, every X-Forwarded-Host hop and the configured URLs, deduped', () => {
    expect(
      selfHostnames({
        host: '127.0.0.1:3100',
        forwardedHost: 'cari.rnd.huawei.com, proxy.internal',
        urls: ['https://cari.rnd.huawei.com/ai-community/api/auth', undefined, 'not a url'],
      }).sort(),
    ).toEqual(['127.0.0.1', 'cari.rnd.huawei.com', 'proxy.internal']);
  });
});

describe('planOrphanSweep', () => {
  it('drops .tmp leftovers always and keys only when no profile references them', () => {
    const entries = [
      { relPath: 'image/a.png', key: 'image/a.png' },
      { relPath: 'video/b.mp4', key: 'video/b.mp4' },
      { relPath: 'loop/c.mp4.tmp.mp4', key: null },
    ];
    expect(planOrphanSweep(entries, new Set(['video/b.mp4']))).toEqual([entries[0], entries[2]]);
    expect(planOrphanSweep(entries, new Set())).toEqual(entries);
    expect(planOrphanSweep([], new Set(['image/a.png']))).toEqual([]);
  });
});

describe('planProfileWrite', () => {
  const current = { card: { style: 'reflective', status: '在线', blur: 20 }, bannerUrl: null };

  it('refuses a non-object body', () => {
    for (const body of [null, undefined, 'x', 42, []]) {
      expect(planProfileWrite(body, current)).toEqual({ ok: false, error: 'invalid_input' });
    }
  });

  it('writes only the fields the body carried', () => {
    const r = planProfileWrite({ headline: '  Agent 工程师  ' }, current);
    expect(r.ok && r.plan).toEqual({ profile: { headline: 'Agent 工程师' } });
    expect(planProfileWrite({}, current)).toEqual({ ok: true, plan: { profile: {} } });
  });

  it('sanitizes content rather than refusing it', () => {
    const r = planProfileWrite(
      {
        headline: 'x'.repeat(HEADLINE_MAX + 20),
        aboutMd: 'a\r\nb' + 'c'.repeat(ABOUT_MAX),
        interests: ['#RAG', 'rag', '', 'Agents'],
        links: [{ label: 'GH', url: 'https://github.com/x' }, { url: 'javascript:alert(1)' }],
      },
      current,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.plan.profile.headline ?? '')).toHaveLength(HEADLINE_MAX);
    expect(r.plan.profile.aboutMd?.startsWith('a\nb')).toBe(true);
    expect(Array.from(r.plan.profile.aboutMd ?? '')).toHaveLength(ABOUT_MAX);
    expect(r.plan.profile.interests).toEqual(['RAG', 'Agents']);
    expect(r.plan.profile.links).toEqual([{ label: 'GH', url: 'https://github.com/x' }]);
  });

  it('stores blank text as NULL', () => {
    const r = planProfileWrite({ headline: '   ', aboutMd: null }, current);
    expect(r.ok && r.plan.profile).toEqual({ headline: null, aboutMd: null });
  });

  it('refuses a wrong SHAPE — a garbage layout must never silently un-hide sections', () => {
    expect(planProfileWrite({ layout: 'skills' }, current)).toMatchObject({ ok: false, field: 'layout' });
    expect(planProfileWrite({ layout: ['skills'] }, current)).toMatchObject({ ok: false, field: 'layout' });
    expect(planProfileWrite({ card: 'holo' }, current)).toMatchObject({ ok: false, field: 'card' });
    expect(planProfileWrite({ interests: 'a,b' }, current)).toMatchObject({ ok: false, field: 'interests' });
    expect(planProfileWrite({ links: {} }, current)).toMatchObject({ ok: false, field: 'links' });
    expect(planProfileWrite({ headline: 7 }, current)).toMatchObject({ ok: false, field: 'headline' });
  });

  it('stores the layout as a complete object; null = 恢复默认 (never a NULL column)', () => {
    const r = planProfileWrite({ layout: { order: ['shelf', 'bogus', 'skills'], hidden: ['comments', 'x'] } }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = r.plan.profile.layout as { order: string[]; hidden: string[] };
    expect(stored.order.slice(0, 2)).toEqual(['shelf', 'skills']);
    expect(stored.order).toHaveLength(PROFILE_SECTIONS.length);
    expect(stored.hidden).toEqual(['comments']);
    // Round-trips through the reader untouched, with no legacy fallback involved.
    expect(parseProfileLayout(stored, { showProfileSkills: false } as never)).toEqual(stored);

    const reset = planProfileWrite({ layout: null }, current);
    expect(reset.ok && reset.plan.profile.layout).toEqual(defaultProfileLayout());
  });

  it('merges a partial card over the stored one; null resets', () => {
    const r = planProfileWrite({ card: { tilt: false, theme: '#ABCDEF', blur: 999 } }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.profile.card).toEqual({
      ...DEFAULT_CARD_CONFIG,
      style: 'reflective',
      status: '在线',
      tilt: false,
      theme: '#abcdef',
      blur: 24,
    });
    const reset = planProfileWrite({ card: null }, current);
    expect(reset.ok && reset.plan.profile.card).toEqual({ ...DEFAULT_CARD_CONFIG });
  });

  it('only touches bannerUrl when it actually changes, and only to an uploader URL', () => {
    expect(planProfileWrite({ bannerUrl: IMG }, current)).toEqual({
      ok: true,
      plan: { profile: {}, bannerUrl: IMG },
    });
    expect(planProfileWrite({ bannerUrl: IMG }, { ...current, bannerUrl: IMG })).toEqual({
      ok: true,
      plan: { profile: {} },
    });
    expect(planProfileWrite({ bannerUrl: 'https://example.com/b.png' }, current)).toMatchObject({
      ok: false,
      field: 'bannerUrl',
    });
    expect(planProfileWrite({ bannerUrl: '' }, { ...current, bannerUrl: IMG })).toEqual({
      ok: true,
      plan: { profile: {}, bannerUrl: null },
    });
  });
});

describe('parseCardMediaInput', () => {
  const SECRET = 'test-secret-test-secret-0123456789';
  const mine = profileMediaOwnerTag('user-me', SECRET);
  const theirs = profileMediaOwnerTag('user-other', SECRET);
  const V = `video/${mine}-V1StGXR8_Z5jdHi6B-myT.mp4`;
  const P = `poster/${mine}-V1StGXR8_Z5jdHi6B-myT.jpg`;
  const L = `loop/${mine}-V1StGXR8_Z5jdHi6B-myT.mp4`;
  const I = `image/${mine}-V1StGXR8_Z5jdHi6B-myT.webp`;
  const bad = { ok: false, error: 'invalid_input' };

  it('accepts an image, and a video with optional poster/loop', () => {
    expect(parseCardMediaInput({ kind: 'image', mediaKey: I }, mine)).toEqual({
      ok: true,
      input: { kind: 'image', mediaKey: I, posterKey: null, loopKey: null },
    });
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V, posterKey: P, loopKey: L }, mine)).toEqual({
      ok: true,
      input: { kind: 'video', mediaKey: V, posterKey: P, loopKey: L },
    });
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V }, mine)).toEqual({
      ok: true,
      input: { kind: 'video', mediaKey: V, posterKey: null, loopKey: null },
    });
  });

  it('refuses a key of the wrong kind in any slot', () => {
    expect(parseCardMediaInput({ kind: 'image', mediaKey: V }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: I }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V, posterKey: L }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V, loopKey: V }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'image', mediaKey: I, posterKey: P }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'loop', mediaKey: L }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'image', mediaKey: '../images/x.png' }, mine)).toEqual(bad);
    expect(parseCardMediaInput(null, mine)).toEqual(bad);
  });

  it("refuses another member's key — in every slot — and legacy untagged keys", () => {
    const swap = (k: string) => k.replace(mine, theirs);
    expect(parseCardMediaInput({ kind: 'image', mediaKey: swap(I) }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: swap(V), posterKey: P, loopKey: L }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V, posterKey: swap(P), loopKey: L }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'video', mediaKey: V, posterKey: P, loopKey: swap(L) }, mine)).toEqual(bad);
    expect(parseCardMediaInput({ kind: 'image', mediaKey: 'image/V1StGXR8_Z5jdHi6B-myT.webp' }, mine)).toEqual(bad);
    // The same bytes are accepted for their actual uploader.
    expect(parseCardMediaInput({ kind: 'image', mediaKey: swap(I) }, theirs)).toMatchObject({ ok: true });
  });
});

describe('parseCardClipInput', () => {
  const SECRET = 'test-secret-test-secret-0123456789';
  const mine = profileMediaOwnerTag('user-me', SECRET);
  const theirs = profileMediaOwnerTag('user-other', SECRET);
  const V = `video/${mine}-V1StGXR8_Z5jdHi6B-myT.mov`;
  const bad = { ok: false, error: 'invalid_input' };

  it('accepts my video key with numeric times; cover is optional (null ⇒ default)', () => {
    expect(parseCardClipInput({ videoKey: V, start: 10, end: 35, cover: 20 }, mine)).toEqual({
      ok: true,
      input: { videoKey: V, start: 10, end: 35, cover: 20 },
    });
    expect(parseCardClipInput({ videoKey: V, start: 0, end: 12 }, mine)).toEqual({
      ok: true,
      input: { videoKey: V, start: 0, end: 12, cover: undefined },
    });
    expect(parseCardClipInput({ videoKey: V, start: 0, end: 12, cover: null }, mine)).toMatchObject({
      ok: true,
      input: { cover: undefined },
    });
  });

  it("refuses another member's key, a legacy untagged key and any non-video key", () => {
    expect(parseCardClipInput({ videoKey: V.replace(mine, theirs), start: 0, end: 5 }, mine)).toEqual(bad);
    expect(parseCardClipInput({ videoKey: 'video/V1StGXR8_Z5jdHi6B-myT.mp4', start: 0, end: 5 }, mine)).toEqual(bad);
    for (const kind of ['loop', 'poster', 'image']) {
      const ext = kind === 'loop' ? 'mp4' : 'jpg';
      expect(parseCardClipInput({ videoKey: `${kind}/${mine}-V1StGXR8_Z5jdHi6B-myT.${ext}`, start: 0, end: 5 }, mine)).toEqual(bad);
    }
  });

  it('refuses a wrong SHAPE (strings, NaN, missing fields, non-objects)', () => {
    for (const body of [
      null,
      [],
      'x',
      { videoKey: V, start: '0', end: 5 },
      { videoKey: V, start: 0 },
      { videoKey: V, start: 0, end: Number.NaN },
      { videoKey: V, start: 0, end: 5, cover: '3' },
      { videoKey: V, start: 0, end: Number.POSITIVE_INFINITY },
    ]) {
      expect(parseCardClipInput(body, mine)).toEqual(bad);
    }
  });
});

describe('planCardClip (clamped against the PROBED duration)', () => {
  it('keeps an in-bounds range and its cover', () => {
    expect(planCardClip({ start: 10, end: 35, cover: 20 }, 45)).toEqual({ start: 10, end: 35, cover: 20, duration: 45 });
  });

  it(`never cuts more than ${PROFILE_CLIP_MAX_SECONDS} s, nor past the end of the source`, () => {
    expect(planCardClip({ start: 5, end: 44, cover: undefined }, 45)).toEqual({ start: 5, end: 35, cover: 5.5, duration: 45 });
    expect(planCardClip({ start: 44.9, end: 999, cover: -5 }, 45)).toEqual({ start: 44, end: 45, cover: 44, duration: 45 });
    // The client's idea of the duration is irrelevant: a range past a 12 s file is cut back to it.
    expect(planCardClip({ start: 0, end: 30, cover: 99 }, 12.04)).toEqual({ start: 0, end: 12, cover: 11.9, duration: 12 });
  });

  it('uses a short source whole', () => {
    expect(planCardClip({ start: 0, end: 12, cover: undefined }, 12)).toEqual({ start: 0, end: 12, cover: 0.5, duration: 12 });
    expect(planCardClip({ start: 3, end: 3, cover: undefined }, 0.6)).toEqual({ start: 0, end: 0.6, cover: 0.3, duration: 0.6 });
  });

  it('is null without a real duration', () => {
    expect(planCardClip({ start: 0, end: 5, cover: undefined }, 0)).toBeNull();
    expect(planCardClip({ start: 0, end: 5, cover: undefined }, Number.NaN)).toBeNull();
  });

  it('stores exactly what parseStoredClip reads back (the trimmer reopens on the range that was cut)', () => {
    for (const [input, dur] of [
      [{ start: 10, end: 35, cover: 20 }, 45],
      [{ start: 1.23, end: 17.89, cover: 3.33 }, 61.37],
      [{ start: 0, end: 30, cover: undefined }, 12.96],
    ] as const) {
      const plan = planCardClip(input, dur);
      expect(plan).not.toBeNull();
      expect(parseStoredClip(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    }
  });
});

describe('ownCardClip', () => {
  const stored = { start: 1, end: 9, cover: 2, duration: 20 };
  const L = 'loop/V1StGXR8_Z5jdHi6B-myT.mp4';

  it('is the stored range only for a video card that has a clip', () => {
    expect(ownCardClip('video', L, stored)).toEqual(stored);
    expect(ownCardClip('video', null, stored)).toBeNull(); // poster-only video
    expect(ownCardClip('image', L, stored)).toBeNull();
    expect(ownCardClip(null, null, stored)).toBeNull();
    expect(ownCardClip('video', L, null)).toBeNull(); // media attached before clips existed
    expect(ownCardClip('video', L, { start: 'x' })).toBeNull();
  });
});

describe('clipOwnCardVideo — refusals before any render or query', () => {
  const userId = 'user-clip-route';
  const key = newProfileMediaKey('video', 'mp4', ownerTagFor(userId));

  afterAll(async () => {
    setMediaToolBinaries(null);
    await fsp.rm(TMP_STORAGE, { recursive: true, force: true });
  });

  it("400s someone else's key and a non-video key without touching the disk", async () => {
    const theirs = newProfileMediaKey('video', 'mp4', ownerTagFor('someone-else'));
    expect(await clipOwnCardVideo(userId, { videoKey: theirs, start: 0, end: 5 })).toEqual({
      ok: false,
      status: 400,
      error: 'invalid_input',
    });
    expect(await clipOwnCardVideo(userId, { videoKey: key.replace('video/', 'loop/'), start: 0, end: 5 })).toMatchObject({
      status: 400,
    });
  });

  it('404s my key when the original is not on disk', async () => {
    expect(await clipOwnCardVideo(userId, { videoKey: key, start: 0, end: 5 })).toEqual({
      ok: false,
      status: 404,
      error: 'media_missing',
    });
  });

  it('501s ffmpeg_unavailable on a box without ffmpeg (the editor then falls back to a poster-only card)', async () => {
    const full = profileMediaAbsPath(key)!;
    expect(full.startsWith(TMP_STORAGE)).toBe(true);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, 'an uploaded original');
    setMediaToolBinaries({ ffmpeg: 'aic-no-such-ffmpeg-binary' });
    expect(await clipOwnCardVideo(userId, { videoKey: key, start: 0, end: 5 })).toEqual({
      ok: false,
      status: 501,
      error: 'ffmpeg_unavailable',
    });
    // ffprobe alone missing is the same answer: the real duration comes from it.
    setMediaToolBinaries({ ffprobe: 'aic-no-such-ffprobe-binary' });
    expect(await clipOwnCardVideo(userId, { videoKey: key, start: 0, end: 5 })).toMatchObject({ status: 501 });
  });
});

describe('clipOwnCardVideo — render wiring against fake tools (no database reached)', { timeout: 30_000 }, () => {
  const userId = 'user-clip-wiring';
  const toolDir = path.join(os.tmpdir(), `aic-fake-media-tools-${process.pid}`);
  const probeJson = path.join(toolDir, 'probe.json');
  const probeLog = path.join(toolDir, 'ffprobe.args');
  const ffmpegLog = path.join(toolDir, 'ffmpeg.args');
  const probeSleep = path.join(toolDir, 'probe.sleep');

  // `-version` succeeds (tools "installed"); a probe logs its argv, optionally
  // sleeps, then prints the fixture; ffmpeg logs its argv and FAILS, so every
  // request ends at 500 clip_failed before the attach transaction.
  const FFPROBE = `#!/bin/sh
[ "$1" = "-version" ] && exit 0
printf '%s\n' "$*" >> '${probeLog}'
[ -f '${probeSleep}' ] && sleep "$(cat '${probeSleep}')"
cat '${probeJson}'
`;
  const FFMPEG = `#!/bin/sh
[ "$1" = "-version" ] && exit 0
printf '%s\n' "$*" >> '${ffmpegLog}'
exit 1
`;

  async function upload(): Promise<string> {
    const key = newProfileMediaKey('video', 'mp4', ownerTagFor(userId));
    const full = profileMediaAbsPath(key)!;
    expect(full.startsWith(TMP_STORAGE)).toBe(true);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, 'an uploaded original');
    return key;
  }

  function probeFixture(fixture: unknown) {
    fs.writeFileSync(probeJson, JSON.stringify(fixture));
    fs.rmSync(probeLog, { force: true });
    fs.rmSync(ffmpegLog, { force: true });
  }

  beforeAll(async () => {
    await fsp.mkdir(toolDir, { recursive: true });
    await fsp.writeFile(path.join(toolDir, 'ffprobe'), FFPROBE, { mode: 0o755 });
    await fsp.writeFile(path.join(toolDir, 'ffmpeg'), FFMPEG, { mode: 0o755 });
    setMediaToolBinaries({ ffmpeg: path.join(toolDir, 'ffmpeg'), ffprobe: path.join(toolDir, 'ffprobe') });
  });

  afterAll(async () => {
    setMediaToolBinaries(null);
    await fsp.rm(toolDir, { recursive: true, force: true });
  });

  it('clamps the range to the VIDEO stream (not an audio tail) and encodes a sub-1 fps source at 1 fps, all under the input guard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const key = await upload();
      probeFixture({
        streams: [
          { codec_type: 'video', width: 640, height: 360, avg_frame_rate: '1/2', r_frame_rate: '1/2', duration: '8.000000' },
          { codec_type: 'audio', duration: '40.000000' },
        ],
        format: { duration: '40.000000' },
      });
      // The browser trimmer measured 40 s (the longest track) and offered the silent tail.
      expect(await clipOwnCardVideo(userId, { videoKey: key, start: 20, end: 40, cover: 30 })).toEqual({
        ok: false,
        status: 500,
        error: 'clip_failed',
      });
      const probeArgs = fs.readFileSync(probeLog, 'utf8');
      expect(probeArgs).toContain('-format_whitelist mov,mp4,m4a,3gp,3g2,mj2,matroska,webm -protocol_whitelist file');
      const clipCall = fs.readFileSync(ffmpegLog, 'utf8').trim().split('\n')[0];
      // 20–40 against 8 s of picture ⇒ the last second (7–8), never a frameless 20–40.
      expect(clipCall).toContain('-ss 7.000 -i ');
      expect(clipCall).toContain(' -t 1.000 ');
      expect(clipCall).toContain(' -r 1 ');
      expect(clipCall).toContain('-format_whitelist mov,mp4,m4a,3gp,3g2,mj2,matroska,webm -protocol_whitelist file -threads 2 -ss');
      expect(clipCall).toContain('-filter_threads 2');
    } finally {
      warn.mockRestore();
    }
  });

  it('lets one member hold only ONE clip request at a time (409 clip_in_progress + retry-after), and frees it afterwards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const key = await upload();
      probeFixture({ streams: [{ codec_type: 'video', avg_frame_rate: '30/1', duration: '45' }], format: { duration: '45' } });
      fs.writeFileSync(probeSleep, '1');
      const first = clipOwnCardVideo(userId, { videoKey: key, start: 0, end: 10 });
      // Wait until the first request is inside the probe — past the single-flight claim.
      for (let i = 0; i < 200 && !fs.existsSync(probeLog); i++) await new Promise((r) => setTimeout(r, 10));
      expect(fs.existsSync(probeLog)).toBe(true);

      expect(await clipOwnCardVideo(userId, { videoKey: key, start: 5, end: 15 })).toEqual({
        ok: false,
        status: 409,
        error: 'clip_in_progress',
        retryAfter: CLIP_IN_PROGRESS_RETRY_AFTER_SEC,
      });
      // Another member is not held up by it (reaches its own render → the fake encoder's 500).
      const other = 'user-clip-wiring-other';
      const otherKey = newProfileMediaKey('video', 'mp4', ownerTagFor(other));
      await fsp.writeFile(profileMediaAbsPath(otherKey)!, 'their original');
      const otherResult = clipOwnCardVideo(other, { videoKey: otherKey, start: 0, end: 5 });
      // Shape refusals never claim the slot either.
      expect(await clipOwnCardVideo(userId, { videoKey: key, start: 'x', end: 5 })).toMatchObject({ status: 400 });

      expect(await first).toMatchObject({ status: 500, error: 'clip_failed' });
      expect(await otherResult).toMatchObject({ status: 500, error: 'clip_failed' });
      fs.rmSync(probeSleep, { force: true });
      // Released in `finally`: the next request goes through to its own render again.
      expect(await clipOwnCardVideo(userId, { videoKey: key, start: 5, end: 15 })).toMatchObject({ status: 500, error: 'clip_failed' });
    } finally {
      fs.rmSync(probeSleep, { force: true });
      warn.mockRestore();
    }
  });
});

describe('droppedMediaKeys', () => {
  it('lists only previous keys the new set no longer references', () => {
    const prev = { cardMediaKey: 'video/a.mp4', cardPosterKey: 'poster/a.jpg', cardLoopKey: 'loop/a.mp4' };
    expect(droppedMediaKeys(prev, { cardMediaKey: 'image/b.png', cardPosterKey: null, cardLoopKey: null })).toEqual([
      'video/a.mp4',
      'poster/a.jpg',
      'loop/a.mp4',
    ]);
    // Re-saving the same video with a new poster keeps the video and loop.
    expect(
      droppedMediaKeys(prev, { cardMediaKey: 'video/a.mp4', cardPosterKey: 'poster/b.jpg', cardLoopKey: 'loop/a.mp4' }),
    ).toEqual(['poster/a.jpg']);
    expect(droppedMediaKeys({ cardMediaKey: null, cardPosterKey: null, cardLoopKey: null }, prev)).toEqual([]);
  });
});

describe('profileSectionAllowed (SPEC §3.1)', () => {
  const layout = { ...defaultProfileLayout(), hidden: ['docs' as const, 'zones' as const] };
  const anon = { loggedIn: false, canSeeHidden: false };
  const member = { loggedIn: true, canSeeHidden: false };
  const ownerOrIdentity = { loggedIn: true, canSeeHidden: true };

  it('keeps login-walled sources away from anonymous viewers', () => {
    expect(profileSectionAllowed('videos', layout, anon)).toBe(false);
    expect(profileSectionAllowed('votes', layout, anon)).toBe(false);
    expect(profileSectionAllowed('skills', layout, anon)).toBe(true);
    expect(profileSectionAllowed('videos', layout, member)).toBe(true);
  });

  it('hides a hidden section from everyone but the owner / identity holders', () => {
    expect(profileSectionAllowed('docs', layout, anon)).toBe(false);
    expect(profileSectionAllowed('docs', layout, member)).toBe(false);
    expect(profileSectionAllowed('docs', layout, ownerOrIdentity)).toBe(true);
    // Hidden AND login-only: still needs a session even for canSeeHidden.
    expect(profileSectionAllowed('zones', layout, { loggedIn: false, canSeeHidden: true })).toBe(false);
  });
});

describe('pickCardStats', () => {
  it('keeps non-zero figures in layout order, at most three', () => {
    expect(
      pickCardStats([
        { key: 'skills', value: 4, order: 3 },
        { key: 'docs', value: 0, order: 0 },
        { key: 'posts', value: 12, order: 1 },
        { key: 'videos', value: 2, order: 2 },
      ]),
    ).toEqual([
      { key: 'posts', value: 12 },
      { key: 'videos', value: 2 },
      { key: 'skills', value: 4 },
    ]);
    expect(
      pickCardStats([
        { key: 'skills', value: 1, order: 0 },
        { key: 'docs', value: 1, order: 1 },
        { key: 'posts', value: 1, order: 2 },
        { key: 'videos', value: 1, order: 3 },
      ]).map((s) => s.key),
    ).toEqual(['skills', 'docs', 'posts']);
  });

  it('shows nothing for a member with nothing (no "0 · 0 · 0" card)', () => {
    expect(pickCardStats([{ key: 'skills', value: 0, order: 0 }])).toEqual([]);
  });
});

describe('decideCardMedia', () => {
  const V = 'video/V1StGXR8_Z5jdHi6B-myT.mp4';
  const P = 'poster/V1StGXR8_Z5jdHi6B-myT.jpg';
  const L = 'loop/V1StGXR8_Z5jdHi6B-myT.mp4';
  const I = 'image/V1StGXR8_Z5jdHi6B-myT.png';

  it('an image needs its file', () => {
    expect(decideCardMedia({ kind: 'image', media: I, poster: null, loop: null }, { media: 10, poster: null, loop: null })).toEqual({
      kind: 'image',
      url: `/api/profile/media/${I}`,
      posterUrl: null,
      playUrl: null,
    });
    expect(decideCardMedia({ kind: 'image', media: I, poster: null, loop: null }, { media: null, poster: null, loop: null })).toBeNull();
    expect(decideCardMedia({ kind: 'image', media: I, poster: null, loop: null }, { media: 0, poster: null, loop: null })).toBeNull();
  });

  const ORIGINAL = `/api/profile/media/${V}`;
  /** No field of a video's card media may ever point at the uploaded original. */
  const neverOriginal = (m: ReturnType<typeof decideCardMedia>) =>
    expect([m?.url, m?.posterUrl, m?.playUrl]).not.toContain(ORIGINAL);

  it('a video plays its loop when there is one — url is the loop, never the original', () => {
    const m = decideCardMedia({ kind: 'video', media: V, poster: P, loop: L }, { media: null, poster: 1000, loop: 900_000 });
    expect(m).toEqual({
      kind: 'video',
      url: `/api/profile/media/${L}`,
      posterUrl: `/api/profile/media/${P}`,
      playUrl: `/api/profile/media/${L}`,
    });
    neverOriginal(m);
  });

  it('without a loop a video is poster-only, whatever the size of the original', () => {
    const m = decideCardMedia({ kind: 'video', media: V, poster: P, loop: null }, { media: 1, poster: 5, loop: null });
    expect(m).toEqual({ kind: 'video', url: `/api/profile/media/${P}`, posterUrl: `/api/profile/media/${P}`, playUrl: null });
    neverOriginal(m);
    // A loop key whose file vanished is poster-only the same way.
    expect(decideCardMedia({ kind: 'video', media: V, poster: P, loop: L }, { media: 1, poster: 5, loop: null })?.playUrl).toBeNull();
  });

  it('a video with neither a loop nor a poster is no media at all', () => {
    expect(decideCardMedia({ kind: 'video', media: V, poster: null, loop: null }, { media: 5, poster: null, loop: null })).toBeNull();
    expect(decideCardMedia({ kind: 'video', media: V, poster: P, loop: L }, { media: 5, poster: null, loop: null })).toBeNull();
  });

  it("does not need the original's file (it is never shown); a missing poster is only a missing poster", () => {
    expect(decideCardMedia({ kind: 'video', media: V, poster: P, loop: L }, { media: null, poster: 5, loop: 5 })?.playUrl).toBe(
      `/api/profile/media/${L}`,
    );
    expect(decideCardMedia({ kind: 'video', media: V, poster: P, loop: L }, { media: 5, poster: null, loop: 5 })?.posterUrl).toBeNull();
  });

  it('never trusts a stored key of the wrong shape or kind', () => {
    expect(decideCardMedia({ kind: 'image', media: V, poster: null, loop: null }, { media: 5, poster: null, loop: null })).toBeNull();
    // A video key in the loop slot is NOT a way to get the original played.
    expect(decideCardMedia({ kind: 'video', media: V, poster: I, loop: V }, { media: 5, poster: 5, loop: 5 })).toBeNull();
    expect(decideCardMedia({ kind: 'video', media: I, poster: P, loop: L }, { media: 5, poster: 5, loop: 5 })).toBeNull();
    expect(decideCardMedia({ kind: 'gif', media: I, poster: null, loop: null }, { media: 5, poster: null, loop: null })).toBeNull();
  });
});

describe('badges', () => {
  const tag = (key: string, extra: Partial<Parameters<typeof toPublicUserTag>[0]> = {}) =>
    toPublicUserTag(
      { key, name: key.toUpperCase(), description: null, color: 'blue', icon: null, kind: 'manual', ...extra },
      new Date('2026-09-01T00:00:00Z'),
    );

  it('passes a role description through publicRoleBadge only when it was selected', () => {
    expect(publicRoleBadge({ key: 'expert', name: '专家', permissions: [] })).toEqual({ key: 'expert', name: '专家' });
    expect(publicRoleBadge({ key: 'expert', name: '专家', description: '领域专家', permissions: [] })).toEqual({
      key: 'expert',
      name: '专家',
      description: '领域专家',
    });
  });

  it('never turns a staff role into a badge, and honorific roles lead the list', () => {
    expect(roleBadge({ key: 'admin', name: '管理员', description: 'x', permissions: ['users'] })).toBeNull();
    expect(roleBadge({ key: 'member', name: '普通成员', description: null, permissions: [] })).toBeNull();
    const role = roleBadge({ key: 'expert', name: '专家', description: '  深耕某一领域  ', permissions: [] });
    expect(role).toEqual({
      key: roleBadgeKey('expert'),
      name: '专家',
      description: '深耕某一领域',
      color: 'amber',
      icon: null,
      kind: 'role',
      grantedAt: null,
    });
    const list = assembleBadges(role, [tag('expert'), tag('speaker')]);
    expect(list.map((b) => b.key)).toEqual(['role:expert', 'expert', 'speaker']);
    expect(list[1]).toMatchObject({ kind: 'manual', grantedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('normalises stored tag rows: blank description ⇒ null, unknown icon ⇒ null', () => {
    expect(tag('a', { description: '   ', icon: 'not-an-icon' })).toMatchObject({ description: null, icon: null });
    expect(tag('a', { description: ' 说明 ', icon: 'trophy' })).toMatchObject({ description: '说明', icon: 'trophy' });
  });

  it('drops a duplicate tag key', () => {
    expect(assembleBadges(null, [tag('a'), tag('a')]).map((b) => b.key)).toEqual(['a']);
  });
});
