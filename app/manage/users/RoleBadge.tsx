import { SUPER_ADMIN_ROLE_KEY } from '@/lib/permissions';

export function RoleBadge({ roleKey, name, staff }: { roleKey: string; name: string; staff: boolean }) {
  const style =
    roleKey === SUPER_ADMIN_ROLE_KEY
      ? { background: '#F3E8FF', color: '#6B21A8' }
      : staff
        ? { background: '#EEF0FF', color: '#3833A8' }
        : { background: '#f4f4f5', color: '#71717a' };
  return (
    <span className="badge" style={style}>
      {name}
    </span>
  );
}
