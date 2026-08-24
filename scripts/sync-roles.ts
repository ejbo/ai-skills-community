// 角色与权限 maintenance — idempotent, safe to re-run any time:
//   1. ensure the three system roles exist (super_admin / admin / member),
//   2. promote legacy admins (isAdmin=true, no role) to super_admin — the same
//      rule the migration applies — and give every other role-less user the
//      member row,
//   3. recompute the User.isAdmin cache from roles.
// Use after `prisma db push` deploys (which skip the migration's data steps),
// after restoring an old dump, or whenever the cache looks out of sync.
//
//   pnpm tsx scripts/sync-roles.ts
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function main() {
  const { resyncIsAdminCache } = await import('../lib/roles');
  const { prisma } = await import('../lib/db');
  const r = await resyncIsAdminCache();
  console.log(
    `✓ roles synced — legacy admins promoted: ${r.legacyPromoted}, members filled: ${r.membersFilled}, ` +
      `isAdmin cache: ${r.staff} staff / ${r.members} members`,
  );
  // 页面访问脱敏 — same data step as migration 20260824180000_add_roles, for deploys
  // that applied the schema with `prisma db push` and never ran the migration SQL.
  const [a, b, c] = await prisma.$transaction([
    prisma.$executeRaw`UPDATE "PageVisit" SET "path" = '/manage/users/[id]'
      WHERE "path" ~ '^/manage/users/[^/?#]+$' AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin")`,
    prisma.$executeRaw`UPDATE "PageVisit" SET "path" = '/users/[handle]'
      WHERE "path" ~ '^/users/[^/?#]+$' AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin")`,
    prisma.$executeRaw`UPDATE "PageVisit" SET "referrer" = NULL
      WHERE "referrer" IS NOT NULL AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin")`,
  ]);
  console.log(`✓ staff page visits redacted — 用户详情: ${a}, 用户主页: ${b}, referrers cleared: ${c}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
