// Per-surface glue for title slugs (docs/contracts/slugs.md): which table, which
// uniqueness scope, which static route segments a slug must not shadow. The
// algorithm itself lives in lib/slug.ts / lib/slug-server.ts — this file only
// names the columns, so every create route, page and the backfill agree.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { freeTitleSlug, isSlugConflict, resolveSlugParam, type ResolvedSlugParam } from '@/lib/slug-server';

type Db = Prisma.TransactionClient | typeof prisma;

const slugsOf = (rows: { slug: string | null }[]) => rows.map((r) => r.slug).filter((s): s is string => !!s);

// ── 活动 (/events/[id]) — visible from creation ⇒ the slug is frozen at create ──

export const EVENT_RESERVED_SLUGS = ['new'] as const;

export function pickEventSlug(title: string, db: Db = prisma): Promise<string> {
  return freeTitleSlug({
    kind: 'event',
    title,
    fallback: 'event',
    reserved: EVENT_RESERVED_SLUGS,
    db,
    takenUnder: (base) => db.event.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } }).then(slugsOf),
  });
}

export function resolveEventParam(param: string): Promise<ResolvedSlugParam | null> {
  return resolveSlugParam({
    kind: 'event',
    param,
    find: (where) => prisma.event.findFirst({ where, select: { id: true, slug: true } }),
  });
}

// ── 讨论话题 (/discussion/topics/[id]) — visible from creation ⇒ frozen ──

export const TOPIC_RESERVED_SLUGS = ['new'] as const;

export function pickTopicSlug(title: string, db: Db = prisma): Promise<string> {
  return freeTitleSlug({
    kind: 'topic',
    title,
    fallback: 'topic',
    reserved: TOPIC_RESERVED_SLUGS,
    db,
    takenUnder: (base) =>
      db.discussionTopic.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } }).then(slugsOf),
  });
}

export function resolveTopicParam(param: string): Promise<ResolvedSlugParam | null> {
  return resolveSlugParam({
    kind: 'topic',
    param,
    find: (where) => prisma.discussionTopic.findFirst({ where, select: { id: true, slug: true } }),
  });
}

// ── 意见反馈 (/feedback/[id]) — visible from creation ⇒ frozen ──

export const FEEDBACK_RESERVED_SLUGS = ['new'] as const;

export function pickFeedbackSlug(title: string, db: Db = prisma): Promise<string> {
  return freeTitleSlug({
    kind: 'feedback',
    title,
    fallback: 'feedback',
    reserved: FEEDBACK_RESERVED_SLUGS,
    db,
    takenUnder: (base) => db.feedback.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } }).then(slugsOf),
  });
}

export function resolveFeedbackParam(param: string): Promise<ResolvedSlugParam | null> {
  return resolveSlugParam({
    kind: 'feedback',
    param,
    find: (where) => prisma.feedback.findFirst({ where, select: { id: true, slug: true } }),
  });
}

// ── 公告 (/announcements/[id]) — publishedAt null = draft: follows the title until published ──

export function pickAnnouncementSlug(title: string, db: Db = prisma, exceptId?: string): Promise<string> {
  return freeTitleSlug({
    kind: 'announcement',
    title,
    fallback: 'announcement',
    db,
    takenUnder: (base) =>
      db.announcement
        .findMany({
          where: { slug: { startsWith: base }, ...(exceptId ? { id: { not: exceptId } } : {}) },
          select: { slug: true },
        })
        .then(slugsOf),
  });
}

export function resolveAnnouncementParam(param: string): Promise<ResolvedSlugParam | null> {
  return resolveSlugParam({
    kind: 'announcement',
    param,
    find: (where) => prisma.announcement.findFirst({ where, select: { id: true, slug: true } }),
  });
}

// ── 技术专区帖子 (/zones/[slug]/posts/[postId]) — unique per zone; follows the title while draft ──

export const ZONE_POST_RESERVED_SLUGS = ['new'] as const;

export function pickZonePostSlug(zoneId: string, title: string, db: Db = prisma, exceptId?: string): Promise<string> {
  return freeTitleSlug({
    kind: 'zone_post',
    title,
    fallback: 'post',
    scope: zoneId,
    reserved: ZONE_POST_RESERVED_SLUGS,
    db,
    takenUnder: (base) =>
      db.zonePost
        .findMany({
          where: { zoneId, slug: { startsWith: base }, ...(exceptId ? { id: { not: exceptId } } : {}) },
          select: { slug: true },
        })
        .then(slugsOf),
  });
}

export function resolveZonePostParam(zoneId: string, param: string): Promise<ResolvedSlugParam | null> {
  return resolveSlugParam({
    kind: 'zone_post',
    param,
    scope: zoneId,
    find: (where) => prisma.zonePost.findFirst({ where: { ...where, zoneId }, select: { id: true, slug: true } }),
  });
}

// ── Backfill (scripts/backfill-title-slugs.ts) ───────────────────────────────
//
// Legacy rows (slug null) get their title slug, oldest first so the earliest row
// keeps the bare slug and later namesakes get -2, -3. Nothing is retired: these
// rows had NO slug, every old link used the id, and the id keeps resolving.

export interface BackfillOptions {
  dry?: boolean;
}

async function backfillRows<T extends { id: string; title: string }>(opts: {
  label: string;
  rows: T[];
  pick: (row: T) => Promise<string>;
  write: (row: T, slug: string) => Promise<unknown>;
  dry?: boolean;
}): Promise<{ updated: number }> {
  let updated = 0;
  for (const row of opts.rows) {
    let slug = await opts.pick(row);
    console.log(`[${opts.label}] ${row.id} → ${slug}`);
    updated += 1;
    if (opts.dry) continue;
    try {
      await opts.write(row, slug);
    } catch (e) {
      if (!isSlugConflict(e)) throw e;
      slug = await opts.pick(row);
      await opts.write(row, slug);
    }
  }
  return { updated };
}

export async function backfillEventSlugs(opts: BackfillOptions = {}): Promise<{ updated: number }> {
  const rows = await prisma.event.findMany({ where: { slug: null }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } });
  return backfillRows({
    label: 'event',
    rows,
    dry: opts.dry,
    pick: (r) => pickEventSlug(r.title),
    write: (r, slug) => prisma.event.updateMany({ where: { id: r.id, slug: null }, data: { slug } }),
  });
}

export async function backfillTopicSlugs(opts: BackfillOptions = {}): Promise<{ updated: number }> {
  const rows = await prisma.discussionTopic.findMany({ where: { slug: null }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } });
  return backfillRows({
    label: 'topic',
    rows,
    dry: opts.dry,
    pick: (r) => pickTopicSlug(r.title),
    write: (r, slug) => prisma.discussionTopic.updateMany({ where: { id: r.id, slug: null }, data: { slug } }),
  });
}

export async function backfillFeedbackSlugs(opts: BackfillOptions = {}): Promise<{ updated: number }> {
  const rows = await prisma.feedback.findMany({ where: { slug: null }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } });
  return backfillRows({
    label: 'feedback',
    rows,
    dry: opts.dry,
    pick: (r) => pickFeedbackSlug(r.title),
    write: (r, slug) => prisma.feedback.updateMany({ where: { id: r.id, slug: null }, data: { slug } }),
  });
}

export async function backfillAnnouncementSlugs(opts: BackfillOptions = {}): Promise<{ updated: number }> {
  const rows = await prisma.announcement.findMany({ where: { slug: null }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } });
  return backfillRows({
    label: 'announcement',
    rows,
    dry: opts.dry,
    pick: (r) => pickAnnouncementSlug(r.title, prisma, r.id),
    write: (r, slug) => prisma.announcement.updateMany({ where: { id: r.id, slug: null }, data: { slug } }),
  });
}

export async function backfillZonePostSlugs(opts: BackfillOptions = {}): Promise<{ updated: number }> {
  const rows = await prisma.zonePost.findMany({
    where: { slug: null },
    select: { id: true, zoneId: true, title: true },
    orderBy: { createdAt: 'asc' },
  });
  return backfillRows({
    label: 'zone_post',
    rows,
    dry: opts.dry,
    pick: (r) => pickZonePostSlug(r.zoneId, r.title, prisma, r.id),
    write: (r, slug) => prisma.zonePost.updateMany({ where: { id: r.id, slug: null }, data: { slug } }),
  });
}
