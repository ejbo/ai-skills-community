import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { findManagedActivity, voteViewerFromSession } from '@/lib/vote-queries';
import { competitionRanks, parseCustomFields } from '@/lib/votes/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Excel formula-injection guard: user-controlled text (titles/filenames)
  // starting with = + - @ would execute as a formula on open.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// GET /api/votes/[id]/export (creator/admin) — ONE maximally detailed CSV: an
// entry-summary row per work, followed by an indented ballot row per voter.
// 排名 agrees with the published gallery (non-hidden approved only); the
// on-page 数据 tab is the primary view, this is the archival/公示 deliverable.
// BOM so Excel opens the CJK content as UTF-8; ASCII-only filename (house rule).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const viewer = voteViewerFromSession(session);
  const activity = await findManagedActivity(params.id, viewer);
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const fieldDefs = parseCustomFields(activity.submissionFields) ?? [];

  const entries = await prisma.voteEntry.findMany({
    where: { activityId: activity.id },
    orderBy: [{ voteCount: 'desc' }, { entryNo: 'asc' }],
    select: {
      id: true,
      entryNo: true,
      title: true,
      description: true,
      formData: true,
      authorName: true,
      authorNo: true,
      originalName: true,
      kind: true,
      voteCount: true,
      commentCount: true,
      hidden: true,
      status: true,
      createdAt: true,
      submitter: { select: { displayName: true, handle: true, isPrivate: true } },
      ballots: {
        orderBy: { updatedAt: 'asc' },
        select: {
          count: true,
          day: true,
          updatedAt: true,
          user: { select: { handle: true, displayName: true, department: true, isPrivate: true } },
        },
      },
    },
  });

  const visible = entries.filter((e) => !e.hidden && e.status === 'approved');
  const ranks = competitionRanks(visible.map((e) => e.voteCount));
  const rankById = new Map(visible.map((e, i) => [e.id, ranks[i]]));
  const statusLabel = (s: string) => (s === 'pending' ? '待审核' : s === 'rejected' ? '已驳回' : '已展示');
  // 隐私账号 contract: handle (= W3 工号 for SSO users) and department are
  // trimmed unless the exporter holds `identity`, displayName stays.
  const privHandle = (u: { handle: string; isPrivate: boolean }) =>
    u.isPrivate && !viewer.canSeeIdentity ? '' : u.handle;

  const header = [
    '行类型',
    '排名',
    '编号',
    '作品名',
    '作者',
    '工号',
    '描述',
    ...fieldDefs.map((f) => f.label),
    '投稿人',
    '投稿人账号',
    '原文件名',
    '类型',
    '状态',
    '已隐藏',
    '总票数',
    '评论数',
    '投稿时间',
    '投票人',
    '投票人账号',
    '投票人部门',
    '票数',
    '日期桶',
    '最后投票时间',
  ];

  const lines: string[][] = [header];
  for (const e of entries) {
    const answers = (e.formData ?? {}) as Record<string, unknown>;
    const base = [
      '作品',
      e.hidden || e.status !== 'approved' ? '' : String(rankById.get(e.id) ?? ''),
      String(e.entryNo),
      e.title,
      e.authorName,
      e.authorNo,
      e.description,
      ...fieldDefs.map((f) => (typeof answers[f.id] === 'string' ? (answers[f.id] as string) : '')),
      e.submitter?.displayName ?? '',
      e.submitter ? privHandle(e.submitter) : '',
      e.originalName,
      e.kind === 'video' ? '视频' : '图片',
      statusLabel(e.status),
      e.hidden ? '是' : '',
      String(e.voteCount),
      String(e.commentCount),
      e.createdAt.toISOString(),
    ];
    lines.push([...base, '', '', '', '', '', '']);
    for (const b of e.ballots) {
      lines.push([
        '投票',
        '',
        String(e.entryNo),
        e.title,
        '',
        '',
        '',
        ...fieldDefs.map(() => ''),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        b.user.displayName,
        privHandle(b.user),
        b.user.isPrivate && !viewer.canSeeIdentity ? '' : (b.user.department ?? ''),
        String(b.count),
        b.day || '(总量)',
        b.updatedAt.toISOString(),
      ]);
    }
  }

  const body = '﻿' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="vote-full-${activity.id}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
