import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { passwordHash: true, authMethod: true },
  });
  const hasPassword = Boolean(user?.passwordHash);
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{hasPassword ? '修改密码' : '设置密码'}</h2>
        {!hasPassword && (
          <p className="mt-1 text-sm text-muted">
            你目前通过 W3 登录。设置密码后可同时用邮箱登录。
          </p>
        )}
        <div className="mt-4">
          <PasswordForm hasPassword={hasPassword} />
        </div>
      </section>
    </div>
  );
}
