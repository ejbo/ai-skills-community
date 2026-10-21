// /reports/[slug] 的参数解析（lib/zones/reports/resolve.ts）：App Router 交进来的动态段是百分号编码的，
// 中文 slug 必须先解码再查库——否则分享页 / 看原文全 404（2026-10-21）。
import { describe, expect, it, vi } from 'vitest';

const calls: unknown[] = [];
vi.mock('@/lib/db', () => ({
  prisma: {
    zoneReport: {
      findUnique: vi.fn(async (args: { where: Record<string, string> }) => {
        calls.push(args.where);
        return args.where.slug === '加研思想院-月报' ? { id: 'r1', createdById: 'u1', visibility: 'private', postId: null, slug: '加研思想院-月报' } : null;
      }),
    },
  },
}));
vi.mock('@/lib/slug-server', () => ({ resolveSlugAlias: vi.fn(async () => null) }));
vi.mock('@/lib/zones/reports/visibility', () => ({ REPORT_GATE_SELECT: { id: true, createdById: true, visibility: true, postId: true } }));

import { resolveReportParam } from '@/lib/zones/reports/resolve';

describe('resolveReportParam', () => {
  it('decodes a percent-encoded CJK slug before looking it up', async () => {
    const row = await resolveReportParam(encodeURIComponent('加研思想院-月报'));
    expect(row?.id).toBe('r1');
    expect(row?.needsRedirect).toBe(false);
    expect(calls[0]).toEqual({ slug: '加研思想院-月报' });
  });
  it('falls back to the row id and flags the redirect when the row has a slug', async () => {
    calls.length = 0;
    expect(await resolveReportParam('nope')).toBeNull();
    expect(calls.map((w) => Object.keys(w as object)[0])).toEqual(['slug', 'id']);
  });
});
