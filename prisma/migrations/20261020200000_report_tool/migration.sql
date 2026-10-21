-- 「聊天记录 → 报告」从版块里的功能变成导航「工具」（2026-10-20，docs/contracts/reports.md）：
-- 报告不再绑定版块（zoneId 可空，分享到版块时才写）；独立分享页 slug + 可见范围；用户补充要求。

ALTER TABLE "ZoneReport" DROP CONSTRAINT "ZoneReport_zoneId_fkey";
ALTER TABLE "ZoneReport" ALTER COLUMN "zoneId" DROP NOT NULL;
ALTER TABLE "ZoneReport" ADD CONSTRAINT "ZoneReport_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ZoneReport" ADD COLUMN "slug" TEXT;
ALTER TABLE "ZoneReport" ADD COLUMN "visibility" "ContentVisibility" NOT NULL DEFAULT 'private';
ALTER TABLE "ZoneReport" ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ZoneReport" ADD COLUMN "instructionMode" TEXT NOT NULL DEFAULT 'append';
CREATE UNIQUE INDEX "ZoneReport_slug_key" ON "ZoneReport"("slug");

-- 生成完成的提醒：站内 + 邮件各一个偏好开关（默认都开）。
ALTER TYPE "NotificationType" ADD VALUE 'report_ready';
ALTER TABLE "NotificationPreference" ADD COLUMN "inAppReportReady" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "emailReportReady" BOOLEAN NOT NULL DEFAULT true;
