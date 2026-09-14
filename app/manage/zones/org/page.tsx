import { requirePermission } from '@/lib/admin';
import { orgCatalogAdminTree } from '@/lib/zones/org-admin';
import { ZonesSubNav } from '../_components/ZonesSubNav';
import { OrgCatalogManager } from './OrgCatalogManager';

export const dynamic = 'force-dynamic';

// /manage/zones/org — 组织架构目录（研究所 → 实验室）。名字就是版块存的值，所以这里改名会
// 同步改到每个版块；删除只撤下目录项，版块保留原值（前台仍可筛选）。写操作走
// /api/admin/zones/org/*（gateApi('zones') + logAdmin）。
export default async function ManageZonesOrgPage() {
  await requirePermission('zones');
  const items = await orgCatalogAdminTree();
  const labCount = items.reduce((n, i) => n + i.labs.length, 0);

  return (
    <div className="space-y-4">
      <ZonesSubNav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">组织架构</h2>
          <p className="mt-1 text-xs text-muted">
            研究所 → 实验室 的目录。前台的研究所侧栏、导航栏磁贴、建版块 / 版块设置里的归属选项都按这里的顺序显示。
            版块存的是<strong>名字</strong>：在这里改名会同步改到每个版块；删除只撤下目录项，已归属的版块保留原值、前台仍可筛选。
          </p>
        </div>
        <span className="text-xs text-muted">
          {items.length} 个研究所 · {labCount} 个实验室
        </span>
      </div>
      <OrgCatalogManager items={items} />
    </div>
  );
}
