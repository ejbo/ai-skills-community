// /api/tools/chat-report/* 共用的门（docs/contracts/reports.md §6）。
//   viewer   = 登录用户 + 站级 `zones` 权限（= 工具管理员）
//   owner    = 创建者或管理员：改设置 / 重试 / 删除 / 分享到版块 / 导出
//   reader   = canSeeReport：详情 / 分享页 / 看原文

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { domainViewer } from '@/lib/permissions';
import { zoneSiteViewer, type ZoneSiteViewer } from '@/lib/zones/access';
import { canSeeReport, isReportOwner, REPORT_GATE_SELECT, type ReportGateRow, type ReportViewer } from './visibility';

export interface ToolContext {
  session: Session & { user: NonNullable<Session['user']> };
  viewer: ReportViewer;
  siteViewer: ZoneSiteViewer;
}

export async function toolContext(): Promise<ToolContext | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return { session: session as ToolContext['session'], viewer: domainViewer(session.user, 'zones'), siteViewer: zoneSiteViewer(session.user) };
}

export async function loadReportGate(id: string): Promise<ReportGateRow | null> {
  return prisma.zoneReport.findUnique({ where: { id }, select: REPORT_GATE_SELECT });
}

/** 404 when missing or invisible；403 when visible but not owned（owner-only routes）。 */
export async function gateReport(ctx: ToolContext, id: string, need: 'read' | 'own'): Promise<ReportGateRow | NextResponse> {
  const row = await loadReportGate(id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canSeeReport(row, ctx.viewer, ctx.siteViewer))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (need === 'own' && !isReportOwner(row, ctx.viewer)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return row;
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
