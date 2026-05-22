import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TokenManager } from './TokenManager';

export const dynamic = 'force-dynamic';

export default async function TokensSettingsPage() {
  const session = await auth();
  const tokens = await prisma.cliToken.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">CLI Token</h2>
        <p className="mt-1 text-sm text-muted">
          用于让 <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">skills</code>{' '}
          命令行工具代替你登录。Token 只在创建时显示一次，请立即复制。
        </p>
        <div className="mt-4">
          <TokenManager
            initialTokens={tokens.map((t) => ({
              id: t.id,
              name: t.name,
              tokenPrefix: t.tokenPrefix,
              scopes: t.scopes,
              lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
              expiresAt: t.expiresAt?.toISOString() ?? null,
              createdAt: t.createdAt.toISOString(),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
