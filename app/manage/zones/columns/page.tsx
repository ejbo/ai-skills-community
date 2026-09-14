import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { invalidateColumnPresets, listColumnPresets } from '@/lib/zones/column-presets';
import { ZonesSubNav } from '../_components/ZonesSubNav';
import { ColumnPresetsManager } from './ColumnPresetsManager';

export const dynamic = 'force-dynamic';

// /manage/zones/columns — 栏目预设（站级标准栏目）。新建版块自动播种；「同步到所有版块」只补缺、
// 不改名不删除。写操作走 /api/admin/zones/column-presets/*（gateApi('zones') + logAdmin）。
export default async function ManageZonesColumnsPage() {
  await requirePermission('zones');
  // The memo may be a minute behind the admin's own last write — read fresh here.
  invalidateColumnPresets();
  const [items, zoneCount] = await Promise.all([listColumnPresets(), prisma.zone.count({ where: { deletedAt: null } })]);

  return (
    <div className="space-y-4">
      <ZonesSubNav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">栏目预设</h2>
          <p className="mt-1 text-xs text-muted">
            站级的标准栏目清单。<strong>新建版块会自动带上这些栏目</strong>（官方栏目，按此顺序）；已有版块用「同步到所有版块」补齐缺失项。
            专区首页左侧的「栏目」筛选也按这个顺序排在最前。版主仍可在自己的版块里增删改栏目——预设是底线，不是上限。
          </p>
        </div>
        <span className="text-xs text-muted">
          {items.length} 个预设 · {zoneCount} 个在线版块
        </span>
      </div>
      <ColumnPresetsManager items={items} zoneCount={zoneCount} />
    </div>
  );
}
