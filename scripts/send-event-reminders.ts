// 活动开始前提醒 — cron entry point (the notifications-poll hook already sweeps
// while people are online; this covers quiet periods). Suggested crontab:
//   */5 * * * * cd /opt/.../ai-skills-community && pnpm exec tsx scripts/send-event-reminders.ts
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '.env.local', override: true });

import { sweepEventReminders } from '@/lib/events/reminders';
import { prisma } from '@/lib/db';

async function main() {
  console.log('▶ 扫描即将开始的活动…');
  const sent = await sweepEventReminders();
  console.log(`✔ 发送 ${sent} 条提醒`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
