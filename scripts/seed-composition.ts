import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';

// Seeds demo "co-install" data so the skill detail 「组合 / Composition」tab shows
// a populated "经常被一起安装" graph instead of the empty-state placeholder.
//
// It creates a handful of clearly-namespaced demo users (demo-coinstall-*, all
// inactive bot accounts) and gives each several overlapping subscriptions +
// favorites across the existing published skills. Idempotent: re-running upserts
// the same rows. To remove later: delete users whose handle starts with
// `demo-coinstall-` — their Subscription/Favorite rows cascade away.
//
//   pnpm db:seed              # base skills first (if not done)
//   pnpm db:seed:composition  # then this

loadEnv();
loadEnv({ path: '.env.local', override: true });

const prisma = new PrismaClient();

const DEMO_USER_COUNT = 12;
const HANDLE_PREFIX = 'demo-coinstall';
const OTHERS_PER_ENGAGER = 4; // how many extra skills each engager also subscribes to
const ENGAGERS_PER_SKILL = 4; // how many demo users engage each skill

/** Fisher–Yates sample of up to n items. (Plain node script — Math.random is fine.) */
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

async function ensureDemoUsers(): Promise<string[]> {
  const passwordHash = await bcrypt.hash('seed-only-no-login', 12);
  const ids: string[] = [];
  for (let i = 0; i < DEMO_USER_COUNT; i++) {
    const handle = `${HANDLE_PREFIX}-${i}`;
    const email = `${handle}@seed.local`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        handle,
        displayName: `Demo 用户 ${i + 1}`,
        passwordHash,
        authMethod: 'password',
        isActive: false, // bot/demo account, like the curator — keeps it out of real listings
        bio: '种子账号：用于演示「经常一起安装」图谱，可安全删除。',
      },
      select: { id: true },
    });
    ids.push(user.id);
  }
  console.log(`✓ Ensured ${ids.length} demo users (${HANDLE_PREFIX}-*)`);
  return ids;
}

async function subscribe(userId: string, skillId: string): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId_skillId: { userId, skillId } },
    update: {},
    create: { userId, skillId },
  });
}

async function favorite(userId: string, skillId: string): Promise<void> {
  await prisma.favorite.upsert({
    where: { userId_skillId: { userId, skillId } },
    update: {},
    create: { userId, skillId },
  });
}

async function main() {
  console.log('▶ Seeding composition (co-install) demo data…');
  const userIds = await ensureDemoUsers();

  const skills = await prisma.skill.findMany({
    where: { status: 'published', deletedAt: null },
    select: { id: true, slug: true },
  });
  if (skills.length < 2) {
    console.log('⚠ Need at least 2 published skills; run `pnpm db:seed` first. Nothing to do.');
    return;
  }

  let subs = 0;
  let favs = 0;
  // Every skill gets a few demo engagers; each engager also subscribes to several
  // OTHER skills, so the engaged skill's "co-install" list is guaranteed non-empty.
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const engagers = Array.from(
      { length: ENGAGERS_PER_SKILL },
      (_, k) => userIds[(i + k) % userIds.length],
    );
    for (const uid of engagers) {
      await subscribe(uid, skill.id);
      subs++;
      const others = sample(
        skills.filter((s) => s.id !== skill.id),
        OTHERS_PER_ENGAGER,
      );
      for (const o of others) {
        await subscribe(uid, o.id);
        subs++;
      }
      if (others[0]) {
        await favorite(uid, others[0].id);
        favs++;
      }
    }
  }

  console.log(`✓ Upserted ~${subs} subscriptions, ~${favs} favorites across ${skills.length} skills`);
  console.log('✔ Composition seed complete — open any skill 的「组合」tab to see it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
