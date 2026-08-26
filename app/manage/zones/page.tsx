import { format } from 'date-fns';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { distinctDirectoryValues } from '@/lib/employee-directory';
import { ZonesManager, type ZoneAdminRow } from './ZonesManager';

export const dynamic = 'force-dynamic';

// /manage/zones — 技术专区后台（新建 / 精选 / 转让主版主 / 软删除 / 恢复）。
// 与其他 manage 页一致：本页只查数据（含已软删除的版块），写操作走
// /api/admin/zones/* （gateApi('zones') + logAdmin）。
const MAX_ROWS = 300;

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export default async function ManageZonesPage() {
  await requirePermission('zones');

  const [rows, total, dirLabs, dirDepartments, zoneLabs, zoneDepartments] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true,
        slug: true,
        name: true,
        tagline: true,
        lab: true,
        department: true,
        visibility: true,
        joinPolicy: true,
        featured: true,
        memberCount: true,
        postCount: true,
        lastActivityAt: true,
        createdAt: true,
        deletedAt: true,
        owner: { select: { handle: true, displayName: true } },
      },
    }),
    prisma.zone.count(),
    distinctDirectoryValues('lab'),
    distinctDirectoryValues('department'),
    prisma.zone.findMany({ where: { lab: { not: '' } }, select: { lab: true }, distinct: ['lab'] }),
    prisma.zone.findMany({ where: { department: { not: '' } }, select: { department: true }, distinct: ['department'] }),
  ]);

  const items: ZoneAdminRow[] = rows.map((z) => ({
    id: z.id,
    slug: z.slug,
    name: z.name,
    tagline: z.tagline,
    lab: z.lab,
    department: z.department,
    visibility: z.visibility,
    joinPolicy: z.joinPolicy,
    featured: z.featured,
    memberCount: z.memberCount,
    postCount: z.postCount,
    lastActivityAtText: format(z.lastActivityAt, 'yyyy-MM-dd HH:mm'),
    createdAtText: format(z.createdAt, 'yyyy-MM-dd'),
    deletedAtText: z.deletedAt ? format(z.deletedAt, 'yyyy-MM-dd HH:mm') : null,
    owner: { handle: z.owner.handle, displayName: z.owner.displayName },
  }));

  const activeCount = items.filter((z) => !z.deletedAtText).length;
  const deletedCount = items.length - activeCount;
  const featuredCount = items.filter((z) => z.featured && !z.deletedAtText).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">技术专区</h2>
          <p className="mt-1 text-xs text-muted">
            版块由主版主自治（角色、成员、内容、Wiki）；后台负责创建、精选、转让主版主与软删除 / 恢复。
            删除为软删除，前台不再可见，随时可恢复。
          </p>
        </div>
        <span className="text-xs text-muted">
          共 {total.toLocaleString()} 个版块 · 在线 {activeCount} · 精选 {featuredCount} · 已删除 {deletedCount}
          {total > MAX_ROWS ? `（最多显示最近 ${MAX_ROWS} 个）` : ''}
        </span>
      </div>
      <ZonesManager
        items={items}
        labs={uniqSorted([...dirLabs, ...zoneLabs.map((r) => r.lab)])}
        departments={uniqSorted([...dirDepartments, ...zoneDepartments.map((r) => r.department)])}
      />
    </div>
  );
}
