-- 技术专区 v5 (2026-09-11): 管理后台可维护的 组织架构目录 / 栏目预设 / 站级设置，
-- 以及版块自己的 主题词 与 主页布局。

-- Zone: 主题词 + 主页布局
ALTER TABLE "Zone" ADD COLUMN "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Zone" ADD COLUMN "sidebar" JSONB NOT NULL DEFAULT '{}';

-- 组织架构目录：研究所 → 实验室（名字即 join key，Zone.lab / Zone.department 继续存名字）
CREATE TABLE "OrgInstitute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgInstitute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgInstitute_name_key" ON "OrgInstitute"("name");
CREATE INDEX "OrgInstitute_sortOrder_idx" ON "OrgInstitute"("sortOrder");

CREATE TABLE "OrgLab" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgLab_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgLab_instituteId_name_key" ON "OrgLab"("instituteId", "name");
CREATE INDEX "OrgLab_instituteId_sortOrder_idx" ON "OrgLab"("instituteId", "sortOrder");
ALTER TABLE "OrgLab" ADD CONSTRAINT "OrgLab_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "OrgInstitute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 栏目预设（站级标准栏目）
CREATE TABLE "ZoneColumnPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZoneColumnPreset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ZoneColumnPreset_name_key" ON "ZoneColumnPreset"("name");
CREATE INDEX "ZoneColumnPreset_sortOrder_idx" ON "ZoneColumnPreset"("sortOrder");

-- 技术专区站级设置（单行）
CREATE TABLE "ZoneSiteSetting" (
    "id" TEXT NOT NULL,
    "copy" JSONB NOT NULL DEFAULT '{}',
    "showWall" BOOLEAN NOT NULL DEFAULT true,
    "showTotals" BOOLEAN NOT NULL DEFAULT true,
    "showHotRail" BOOLEAN NOT NULL DEFAULT true,
    "showFeatured" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZoneSiteSetting_pkey" PRIMARY KEY ("id")
);

-- 把现有版块已经在用的 研究所/实验室 收进目录，管理员一打开就是真实数据而不是空表。
INSERT INTO "OrgInstitute" ("id", "name", "sortOrder", "updatedAt")
SELECT 'orgi_' || substr(md5(lab), 1, 20), lab, 100, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT trim(lab) AS lab FROM "Zone" WHERE "deletedAt" IS NULL AND trim(lab) <> '') AS s
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "OrgLab" ("id", "instituteId", "name", "sortOrder", "updatedAt")
SELECT 'orgl_' || substr(md5(i."id" || '|' || s.department), 1, 20), i."id", s.department, 100, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT trim(lab) AS lab, trim(department) AS department FROM "Zone"
      WHERE "deletedAt" IS NULL AND trim(lab) <> '' AND trim(department) <> '') AS s
JOIN "OrgInstitute" i ON i."name" = s.lab
ON CONFLICT ("instituteId", "name") DO NOTHING;
