import { requireSuperAdmin } from '@/lib/admin';
import { listRolesWithCounts } from '@/lib/roles';
import { RolesEditor } from './RolesEditor';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  await requireSuperAdmin();
  const roles = await listRolesWithCounts();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">角色与权限</h2>
        <span className="text-xs text-muted">{roles.length} 个角色</span>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        每个用户持有一个角色；角色是一组权限。「超级管理员」拥有全部权限且是唯一能在这里配置角色、在用户详情页指派角色的角色；
        「管理员」是可编辑的默认管理员角色；「普通成员」是没有任何后台权限的默认角色。自定义角色可以只勾选某几个板块（例如只管视频与短视频）。
      </p>
      <RolesEditor
        roles={roles.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          description: r.description ?? '',
          isSystem: r.isSystem,
          permissions: r.permissions,
          sortOrder: r.sortOrder,
          userCount: r.userCount,
        }))}
      />
    </div>
  );
}
