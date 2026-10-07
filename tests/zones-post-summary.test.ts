// 技术专区 — an auto summary (摘要 left blank → excerpt of the body) must keep
// following the body; only a summary the author TYPED is kept verbatim.
//
// Regression: the excerpt went into the one `summary` column, the edit page
// loaded it into the 摘要 input as a real value, and every later save sent it
// back — so after the author rewrote the post the card still described the
// first version. Pinned three ways: the pure recognition rules, the write in
// `updateZonePost` (in-memory prisma), and the composer figures that sit beside
// the editor's own counter.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { post: null as Record<string, unknown> | null, updates: [] as Record<string, unknown>[] };
  const tx = {
    zonePost: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return {};
      }),
    },
  };
  return {
    state,
    prisma: {
      // findMany + slugAlias: the title-slug pick (lib/title-slugs.ts) — no namesakes here.
      zonePost: { findUnique: vi.fn(async () => state.post), findMany: vi.fn(async () => []) },
      slugAlias: { findMany: vi.fn(async () => []) },
      zonePostAttachment: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
// Neighbours post-queries pulls in at import time; a summary edit never reaches them.
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: vi.fn(async () => null),
  isValidZoneMediaKey: () => false,
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/queries', () => ({ readableZoneWhere: vi.fn(() => ({})), zoneOrgTree: vi.fn() }));

import { richTextLength } from '@/lib/markdown-text';
import { updateZonePost } from '@/lib/zones/post-queries';
import { AUTO_SUMMARY_MAX, autoPostSummary, isAutoPostSummary, nextPostSummary } from '@/lib/zones/post-summary';
import { ZONE_LIMITS, estimateReadMinutes } from '@/lib/zones/shared';
import { composerBodyStats } from '@/app/zones/_components/post/composer-stats';

const MAX = ZONE_LIMITS.postSummaryMax;
const V1 = 'First body paragraph original text.';
const V2 = 'Completely rewritten body text.';

describe('isAutoPostSummary — recognising the excerpt a save derived', () => {
  it('a blank summary and the body’s own excerpt are auto; typed text is not', () => {
    expect(isAutoPostSummary('', V1)).toBe(true);
    expect(isAutoPostSummary('   ', V1)).toBe(true);
    expect(isAutoPostSummary(autoPostSummary(V1), V1)).toBe(true);
    expect(isAutoPostSummary(` ${autoPostSummary(V1)} `, V1)).toBe(true);
    expect(isAutoPostSummary('A summary I wrote myself.', V1)).toBe(false);
  });

  it('compares against the body the summary was stored WITH — an old excerpt is not auto for a new body', () => {
    expect(isAutoPostSummary(autoPostSummary(V1), V2)).toBe(false);
  });

  it('recognises the long-body excerpt, cut and ellipsised', () => {
    const body = `## Heading\n\n${'word '.repeat(120)}\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const auto = autoPostSummary(body);
    expect(auto.endsWith('…')).toBe(true);
    expect([...auto].length).toBeLessThanOrEqual(AUTO_SUMMARY_MAX + 1);
    expect(isAutoPostSummary(auto, body)).toBe(true);
  });

  it('recognises summaries stored by the PRE-markdown-text excerpt rules, so existing posts unfreeze too', () => {
    // The old chain turned every `-` into a space and swapped tags for spaces;
    // a row written before 2026-09-14 holds exactly that string.
    const body = '发布于 2026-09-14，详见 <span data-color="red">重点</span> 与 [文档](https://example.com/a-b)。\n\n- 第一条';
    const legacy = '发布于 2026 09 14，详见 重点 与 文档。 第一条';
    expect(autoPostSummary(body)).not.toBe(legacy); // the rules really did change
    expect(isAutoPostSummary(legacy, body)).toBe(true);
    const longBody = `${'2026-09-14 '.repeat(40)}end`;
    const longLegacy = `${[...'2026 09 14 '.repeat(40)].slice(0, AUTO_SUMMARY_MAX).join('')}…`;
    expect(isAutoPostSummary(longLegacy, longBody)).toBe(true);
  });
});

describe('nextPostSummary — what an update stores', () => {
  it('re-derives an auto summary from the new body (echoed back or re-used)', () => {
    expect(nextPostSummary({ incoming: autoPostSummary(V1), previousBodyMd: V1, bodyMd: V2, max: MAX })).toBe(autoPostSummary(V2));
    expect(nextPostSummary({ incoming: '', previousBodyMd: V1, bodyMd: V2, max: MAX })).toBe(autoPostSummary(V2));
  });

  it('keeps a typed summary through body edits, trimmed and capped', () => {
    expect(nextPostSummary({ incoming: '  Mine.  ', previousBodyMd: V1, bodyMd: V2, max: MAX })).toBe('Mine.');
    expect(nextPostSummary({ incoming: 'x'.repeat(MAX + 50), previousBodyMd: V1, bodyMd: V2, max: MAX })).toBe('x'.repeat(MAX));
  });
});

describe('updateZonePost — the stored summary follows the body unless it was typed', () => {
  function existing(over: Record<string, unknown> = {}) {
    return {
      id: 'p1',
      zoneId: 'z1',
      authorId: 'author',
      type: 'article',
      title: 'Title',
      summary: autoPostSummary(V1),
      bodyMd: V1,
      coverKey: null,
      linkUrl: null,
      columnId: null,
      visibility: 'zone',
      accessCode: null,
      status: 'draft',
      publishedAt: null,
      deletedAt: null,
      coauthors: [],
      zone: { id: 'z1', slug: 'edge-inference', name: 'Z', ownerId: 'author', visibility: 'public', joinPolicy: 'open', allowGuestComments: false, deletedAt: null },
      attachments: [],
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db.state.updates = [];
  });

  it('a body-only PATCH refreshes an auto summary', async () => {
    db.state.post = existing();
    await updateZonePost('p1', { bodyMd: V2 }, { actorId: 'author' });
    expect(db.state.updates.at(-1)?.summary).toBe(autoPostSummary(V2));
  });

  it('a composer save that echoes the loaded excerpt back refreshes it too', async () => {
    db.state.post = existing();
    await updateZonePost('p1', { title: 'Title', summary: autoPostSummary(V1), bodyMd: V2 }, { actorId: 'author' });
    expect(db.state.updates.at(-1)?.summary).toBe(autoPostSummary(V2));
  });

  it('a typed summary survives a body edit, with or without being re-sent', async () => {
    db.state.post = existing({ summary: 'Hand-written summary.' });
    await updateZonePost('p1', { bodyMd: V2 }, { actorId: 'author' });
    expect(db.state.updates.at(-1)?.summary).toBe('Hand-written summary.');
    await updateZonePost('p1', { summary: 'Hand-written summary.', bodyMd: V2 }, { actorId: 'author' });
    expect(db.state.updates.at(-1)?.summary).toBe('Hand-written summary.');
  });

  it('typing a summary over an auto one stores the typed text', async () => {
    db.state.post = existing();
    await updateZonePost('p1', { summary: 'Now I wrote one.', bodyMd: V2 }, { actorId: 'author' });
    expect(db.state.updates.at(-1)?.summary).toBe('Now I wrote one.');
  });
});

describe('composerBodyStats — the settings sheet agrees with the editor counter', () => {
  it('counts visible characters, not formatting markup (the 147 字 vs 30 repro)', () => {
    const md =
      'The <span data-size="xl"><span data-font="kai"><span data-bg="yellow"><span data-color="red">quick brown</span></span></span></span> fox jumps over';
    expect([...md].length).toBe(147);
    const stats = composerBodyStats(md);
    expect(stats.chars).toBe(30);
    expect(stats.chars).toBe(richTextLength(md)); // RichTextEditor's own `n / max`
    expect(stats.readMinutes).toBe(estimateReadMinutes('The quick brown fox jumps over'));
  });
});
