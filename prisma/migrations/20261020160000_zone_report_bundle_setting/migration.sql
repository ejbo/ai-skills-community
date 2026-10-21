-- 版块报告：整包上传（bundleKey）+ 账号姓名表（namesJson）+ 后台报告模型配置（2026-10-20，docs/contracts/reports.md §2a / §6）。

ALTER TABLE "ZoneReport" ADD COLUMN "bundleKey" TEXT;
ALTER TABLE "ZoneReport" ADD COLUMN "namesJson" JSONB;

CREATE TABLE "ZoneReportSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "useLibrary" BOOLEAN NOT NULL DEFAULT true,
    "llmProvider" TEXT,
    "llmBaseUrl" TEXT,
    "llmApiKey" TEXT,
    "llmModel" TEXT,
    "llmDisableThinking" BOOLEAN NOT NULL DEFAULT false,
    "llmJsonMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZoneReportSetting_pkey" PRIMARY KEY ("id")
);
