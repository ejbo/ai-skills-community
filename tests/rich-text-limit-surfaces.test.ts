// 富文本长度契约 — the editor counter and the server must use ONE measure.
//
// RichTextEditor's counter (and its red over-limit state) shows VISIBLE length:
// the formatting spans the editor adds (`<span data-color="red">…</span>`, ~30
// raw characters per coloured phrase) are discounted (lib/markdown-text.ts). A
// server that still validated `z.string().max(N)` on raw length therefore 400'd
// a formatted body the counter said fit, and a normaliser `.slice(0, N)` cut it
// — sometimes inside a tag. The contract (lib/rich-text-limit.ts): every field a
// RichTextEditor with `maxLength` edits validates through `withRichTextLimit`
// with the SAME limit, on every write path, and client gates use
// `isRichTextTooLong`. This suite pins both halves: behaviourally where the
// schema is importable, by source where it is route-local.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isRichTextTooLong, richTextLength } from '@/lib/markdown-text';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { SIDEBAR_CARD_BODY_MAX, parseSidebarLayout } from '@/lib/zones/sidebar';

// Server modules: the schemas are real; persistence, session and zone context are stubbed so the
// PATCH /api/zones/[slug] handler can run the finding's exact repro in-process.
const updates = vi.hoisted(() => [] as unknown[]);
vi.mock('@/lib/db', () => ({ prisma: { zone: { findFirst: async () => null } } }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/audit', () => ({ logAdmin: async () => undefined }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'zh-CN' }));
vi.mock('@/lib/zones/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/zones/access')>()),
  zoneContext: async () => ({ zone: { id: 'z1', slug: 'edge-inference' }, access: { canManage: true, isOwner: true, siteAdmin: false } }),
}));
vi.mock('@/lib/zones/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/zones/queries')>()),
  updateZone: async (_id: string, patch: unknown) => void updates.push(patch),
}));
const { sidebarLayoutInputSchema, zoneInputSchema } = await import('@/lib/zones/queries');
const { eventContentSchema } = await import('@/lib/events/validate');
const { PATCH: patchZone } = await import('@/app/api/zones/[slug]/route');

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Exactly `visible` visible characters, raw well above it (coloured 40-char phrases). */
function formattedBody(visible: number): string {
  const phrase = `<span data-color="red">${'字'.repeat(40)}</span>`;
  const n = Math.floor(visible / 40);
  return phrase.repeat(n) + 'x'.repeat(visible - n * 40);
}

describe('formattedBody fixture', () => {
  it('is at the visible limit, over it raw, and inside the raw ceiling', () => {
    for (const n of [2000, SIDEBAR_CARD_BODY_MAX, 20_000, ZONE_LIMITS.postBodyMax]) {
      const body = formattedBody(n);
      expect(richTextLength(body)).toBe(n);
      expect(body.length).toBeGreaterThan(n);
      expect(isRichTextTooLong(body, n)).toBe(false);
      expect(isRichTextTooLong(`${body}y`, n)).toBe(true);
    }
  });
});

describe('importable schemas accept what the counter accepts, refuse what it marks red', () => {
  it('zone description (create payload)', () => {
    const base = { name: '版块名称', slug: 'rich-limit' };
    const ok = zoneInputSchema.safeParse({ ...base, descriptionMd: formattedBody(ZONE_LIMITS.descriptionMax) });
    expect(ok.success).toBe(true);
    // Stored as sent: no post-zod raw slice in createZone/updateZone either (checked by source below).
    expect(ok.success && ok.data.descriptionMd).toBe(formattedBody(ZONE_LIMITS.descriptionMax));
    expect(zoneInputSchema.safeParse({ ...base, descriptionMd: 'a'.repeat(ZONE_LIMITS.descriptionMax + 1) }).success).toBe(false);
  });

  it('zone sidebar card body: accepted whole, or a 400 — never truncated', () => {
    const body = formattedBody(SIDEBAR_CARD_BODY_MAX);
    const card = { id: 'custom:abcd1234', title: 'card', bodyMd: body };
    const ok = sidebarLayoutInputSchema.safeParse({ custom: [card] });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.custom[0].bodyMd).toBe(body);
    // The create payload uses the same shape (it used to be z.unknown() → a normaliser cut).
    const created = zoneInputSchema.safeParse({ name: '版块名称', slug: 'rich-limit', sidebar: { custom: [card] } });
    expect(created.success && created.data.sidebar.custom[0].bodyMd).toBe(body);

    const over = { ...card, bodyMd: `${body}y` };
    expect(sidebarLayoutInputSchema.safeParse({ custom: [over] }).success).toBe(false);
    expect(zoneInputSchema.safeParse({ name: '版块名称', slug: 'rich-limit', sidebar: { custom: [over] } }).success).toBe(false);
    // The normaliser (it also reads stored rows) never slices a body — it is not the cap, zod is.
    expect(parseSidebarLayout({ custom: [over] }).custom[0].bodyMd).toBe(over.bodyMd);
  });

  it('PATCH /api/zones/[slug]: the settings form save that used to 400 (counter 3000 / 4000, raw ~4500)', async () => {
    const card = { id: 'custom:abcd1234', title: 'card', bodyMd: `<span data-color="red">${'字'.repeat(60)}</span>`.repeat(50) };
    expect(richTextLength(card.bodyMd)).toBe(3000);
    expect(card.bodyMd.length).toBeGreaterThan(SIDEBAR_CARD_BODY_MAX);
    const descriptionMd = `<span data-bg="yellow">${'字'.repeat(60)}</span>\n\n`.repeat(300);
    expect(richTextLength(descriptionMd)).toBeLessThanOrEqual(ZONE_LIMITS.descriptionMax);
    expect(descriptionMd.length).toBeGreaterThan(ZONE_LIMITS.descriptionMax);

    const send = (body: unknown) =>
      patchZone(new Request('http://localhost/api/zones/edge-inference', { method: 'PATCH', body: JSON.stringify(body) }), {
        params: { slug: 'edge-inference' },
      });
    const res = await send({ sidebar: { custom: [card], order: ['about', card.id] }, descriptionMd });
    expect(res.status).toBe(200);
    const saved = updates.at(-1) as { descriptionMd: string; sidebar: { custom: { bodyMd: string }[] } };
    expect(saved.descriptionMd).toBe(descriptionMd);
    expect(saved.sidebar.custom[0].bodyMd).toBe(card.bodyMd);

    // Over the visible cap is still a 400 (the counter is red for it too).
    const n = updates.length;
    expect((await send({ sidebar: { custom: [{ ...card, bodyMd: 'y'.repeat(SIDEBAR_CARD_BODY_MAX + 1) }] } })).status).toBe(400);
    expect((await send({ descriptionMd: 'y'.repeat(ZONE_LIMITS.descriptionMax + 1) })).status).toBe(400);
    expect(updates.length).toBe(n);
  });

  it('event description keeps its own message', () => {
    const field = eventContentSchema.shape.descriptionMd;
    expect(field.safeParse(formattedBody(20_000)).success).toBe(true);
    const over = field.safeParse('a'.repeat(20_001));
    expect(over.success).toBe(false);
    expect(!over.success && over.error.issues[0].message).toBe('活动介绍过长');
  });
});

// ── Source contract: editor maxLength ↔ server schema, surface by surface ─────

interface Surface {
  name: string;
  /** The file rendering `<RichTextEditor maxLength={limit}>` (and any client gate). */
  editor: string;
  limit: string;
  /** Every server file that validates this field on a write path, with the field name. */
  server: Array<[file: string, field: string]>;
}

const SURFACES: Surface[] = [
  { name: '版块主页布局 custom card', editor: 'app/zones/_components/SidebarLayoutEditor.tsx', limit: 'SIDEBAR_CARD_BODY_MAX', server: [['lib/zones/queries.ts', 'bodyMd']] },
  {
    name: '版块 description (settings)',
    editor: 'app/zones/_components/ZoneSettingsForm.tsx',
    limit: 'ZONE_LIMITS.descriptionMax',
    server: [['app/api/zones/[slug]/route.ts', 'descriptionMd']],
  },
  {
    name: '版块 description (create)',
    editor: 'app/zones/_components/CreateZoneWizard.tsx',
    limit: 'ZONE_LIMITS.descriptionMax',
    server: [
      ['lib/zones/queries.ts', 'descriptionMd'],
      ['app/api/admin/zones/route.ts', 'descriptionMd'],
    ],
  },
  {
    name: '专区 post body',
    editor: 'app/zones/_components/post/PostComposer.tsx',
    limit: 'ZONE_LIMITS.postBodyMax',
    server: [
      ['lib/zones/post-queries.ts', 'bodyMd'],
      ['app/api/zones/[slug]/posts/[postId]/route.ts', 'bodyMd'],
    ],
  },
  {
    name: '专区 wiki body',
    editor: 'app/zones/_components/wiki/WikiEditor.tsx',
    limit: 'ZONE_LIMITS.wikiBodyMax',
    server: [
      ['lib/zones/wiki-queries.ts', 'bodyMd'],
      ['app/api/zones/[slug]/wiki/[pageId]/route.ts', 'bodyMd'],
    ],
  },
  {
    name: '专区 comment',
    editor: 'app/zones/_components/post/CommentBox.tsx',
    limit: 'ZONE_LIMITS.commentMax',
    server: [
      ['app/api/zones/[slug]/posts/[postId]/comments/route.ts', 'bodyMd'],
      ['app/api/zones/comments/[id]/route.ts', 'bodyMd'],
    ],
  },
  {
    name: '讨论区 topic',
    editor: 'app/discussion/_components/TopicForm.tsx',
    limit: '20000',
    server: [
      ['app/api/discussion/topics/route.ts', 'bodyMd'],
      ['app/api/discussion/topics/[id]/route.ts', 'bodyMd'],
    ],
  },
  { name: '讨论区 reply', editor: 'app/discussion/_components/TopicReplies.tsx', limit: '5000', server: [['app/api/discussion/topics/[id]/replies/route.ts', 'bodyMd']] },
  {
    name: '讨论区 动态',
    editor: 'app/discussion/_components/PostComposer.tsx',
    limit: '8000',
    server: [
      ['app/api/discussion/posts/route.ts', 'bodyMd'],
      ['app/api/discussion/posts/[id]/route.ts', 'bodyMd'],
    ],
  },
  { name: '讨论区 动态 (inline edit)', editor: 'app/discussion/_components/PostCard.tsx', limit: '8000', server: [['app/api/discussion/posts/[id]/route.ts', 'bodyMd']] },
  { name: '讨论区 动态 comment', editor: 'app/discussion/_components/PostComments.tsx', limit: '2000', server: [['app/api/discussion/posts/[id]/comments/route.ts', 'bodyMd']] },
  { name: '活动 description', editor: 'app/events/_components/EventForm.tsx', limit: '20000', server: [['lib/events/validate.ts', 'descriptionMd']] },
  { name: '投票活动 description', editor: 'app/votes/_components/VoteEditor.tsx', limit: '20000', server: [['app/api/votes/[id]/route.ts', 'descriptionMd']] },
  {
    name: '公告',
    editor: 'app/manage/announcements/AnnouncementEditor.tsx',
    limit: '40000',
    server: [
      ['app/api/admin/announcements/route.ts', 'bodyMd'],
      ['app/api/admin/announcements/[id]/route.ts', 'bodyMd'],
    ],
  },
  { name: '意见反馈', editor: 'app/feedback/_components/FeedbackComposer.tsx', limit: '10000', server: [['app/api/feedback/route.ts', 'bodyMd']] },
  { name: '意见反馈 comment', editor: 'app/feedback/_components/FeedbackComments.tsx', limit: '2000', server: [['app/api/feedback/[id]/comments/route.ts', 'bodyMd']] },
  { name: 'Skill review', editor: 'app/skills/[slug]/ReviewForm.tsx', limit: '2000', server: [['app/api/skills/[slug]/reviews/route.ts', 'bodyMd']] },
  {
    name: '视频 comment',
    editor: 'components/video/CommentComposer.tsx',
    limit: '2000',
    server: [
      ['app/api/videos/[slug]/comments/route.ts', 'bodyMd'],
      ['app/api/videos/[slug]/comments/[id]/route.ts', 'bodyMd'],
    ],
  },
  { name: '视频 comment (inline edit)', editor: 'components/video/CommentItem.tsx', limit: '2000', server: [['app/api/videos/[slug]/comments/[id]/route.ts', 'bodyMd']] },
  { name: '知识库 comment', editor: 'components/library/DocComments.tsx', limit: '10_000', server: [['app/api/library/docs/[id]/comments/route.ts', 'bodyMd']] },
];

/** `limit` as it may be spelled: a constant name, or a number with or without `_` separators. */
function limitPattern(limit: string): string {
  if (!/^[\d_]+$/.test(limit)) return limit.replace(/[.$]/g, '\\$&');
  const digits = limit.replace(/_/g, '');
  return digits.split('').join('_?');
}

/** A VoteEditor may name its constant instead of the literal; both are the same cap. */
const ALIASES: Record<string, string[]> = { '20000': ['VOTE_DESCRIPTION_MAX'] };

describe('every capped RichTextEditor field is validated by visible length on every write path', () => {
  for (const s of SURFACES) {
    it(s.name, () => {
      const limits = [limitPattern(s.limit), ...(ALIASES[s.limit.replace(/_/g, '')] ?? [])].join('|');
      const editor = read(s.editor);
      expect(editor, `${s.editor} passes maxLength`).toMatch(new RegExp(`<RichTextEditor[\\s\\S]*?maxLength=\\{(?:${limits})\\}`));
      for (const [file, field] of s.server) {
        const src = read(file);
        expect(src, `${file}: ${field} uses withRichTextLimit(…, ${s.limit})`).toMatch(
          new RegExp(`\\b${field}:\\s*withRichTextLimit\\(z\\.string\\(\\)[^\\n]*?,\\s*(?:${limits})\\s*[,)]`),
        );
      }
    });
  }
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no raw-length cap survives on a markdown body', () => {
  // Markdown fields that are NOT RichTextEditor-backed, so a raw cap matches their input box.
  const PLAIN_TEXTAREA_FIELDS = new Set([
    'app/api/library/docs/[id]/route.ts:abstractMd', // DocEditor 摘要 = plain textarea
    'app/api/library/notes/[highlightId]/replies/route.ts:bodyMd', // 批注回复 = plain textarea
    'lib/comparison.ts:bodyMd', // SkillComparison — model/admin authored, no editor counter
  ]);

  it('no `*Md: z.string()…max(n)` outside the plain-textarea allowlist', () => {
    const offenders: string[] = [];
    for (const file of [...walk('app/api'), ...walk('lib')]) {
      for (const line of read(file).split('\n')) {
        if (!line.includes('Md:') || !line.includes('.max(')) continue; // cheap prefilter
        const m = /\b(\w*Md):\s*z\s*\.string\(\)(?:\.\w+\([^()]*\))*\.max\(/.exec(line);
        const key = m && `${relative(ROOT, join(ROOT, file))}:${m[1]}`;
        if (key && !PLAIN_TEXTAREA_FIELDS.has(key)) offenders.push(key);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('no raw `.slice(0, …Max)` of a description/body after validation', () => {
    for (const file of ['lib/zones/queries.ts', 'lib/zones/sidebar.ts', 'lib/zones/post-queries.ts', 'lib/zones/wiki-queries.ts']) {
      expect(read(file), file).not.toMatch(/(?:descriptionMd|bodyMd)\.slice\(0,/);
      expect(read(file), file).not.toMatch(/str\(card\.bodyMd/);
    }
  });

  it('no client gate compares a body’s raw .length to a cap', () => {
    const offenders: string[] = [];
    for (const file of [...walk('app'), ...walk('components')]) {
      if (file.startsWith('app/api/')) continue;
      for (const line of read(file).split('\n')) {
        if (!line.includes('.length')) continue; // cheap prefilter
        for (const m of line.matchAll(/(\w+)(?:\.trim\(\))?\.length\s*>=?\s*(?!0\b)[\w.]+/g)) {
          if (/(?:Md|[Bb]ody|Draft)$/.test(m[1])) offenders.push(`${file}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The counter itself: never a bare `value.length > maxLength` again (`maxLength * RAW_CEILING` is the ceiling, fine).
    expect(read('components/RichTextEditor.tsx')).not.toMatch(/\bvalue\.length\s*>\s*maxLength\b(?!\s*\*)/);
  }, 60_000);
});
