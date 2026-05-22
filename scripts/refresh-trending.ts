import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '.env.local', override: true });

import { refreshTrending } from '@/lib/trending';
import { prisma } from '@/lib/db';

async function main() {
  console.log('▶ 刷新 trendingScore…');
  const result = await refreshTrending();
  console.log(`✔ 更新 ${result.updated} 个 Skill，耗时 ${result.tookMs}ms`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
