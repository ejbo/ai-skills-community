-- 角色与权限 (lib/permissions.ts, lib/roles.ts)
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
CREATE INDEX "Role_sortOrder_idx" ON "Role"("sortOrder");

ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- System roles. Ids are fixed so the backfill below can reference them; the app
-- always looks roles up by `key`. The permission list of `admin` mirrors
-- PERMISSION_KEYS in lib/permissions.ts at the time of this migration — later
-- catalog additions are granted explicitly by a super admin (that is the point).
INSERT INTO "Role" ("id", "key", "name", "description", "isSystem", "permissions", "sortOrder", "createdAt", "updatedAt") VALUES
  ('role_super_admin', 'super_admin', '超级管理员', '拥有全部权限；唯一可以配置角色与权限、指派角色的角色。', true, ARRAY['*']::TEXT[], 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_admin', 'admin', '管理员', '默认管理员：拥有全部后台与站内治理权限，但不能配置角色。', true,
     ARRAY['dashboard','users','employees','skills','packs','videos','shorts','discussion','votes','library','categories','announcements','logs','feedback','events','polls','identity']::TEXT[],
     10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_member', 'member', '普通成员', '默认角色：没有任何后台或治理权限。', true, ARRAY[]::TEXT[], 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Backfill: every existing admin already had unrestricted power, so promoting
-- them to super_admin changes nothing today and leaves someone able to open
-- 角色与权限 and hand out narrower roles. Everyone else is an explicit member.
UPDATE "User" SET "roleId" = 'role_super_admin' WHERE "isAdmin" = true;
UPDATE "User" SET "roleId" = 'role_member' WHERE "roleId" IS NULL;

-- 页面访问脱敏 (lib/page-visit.ts): staff members' EXISTING visits to user-specific
-- pages lose the identifying segment, exactly as new rows are written from now on.
-- The page name (用户详情 / 用户主页) and the timestamp stay; WHO they looked at does not.
UPDATE "PageVisit" SET "path" = '/manage/users/[id]'
  WHERE "path" ~ '^/manage/users/[^/?#]+$' AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin");
UPDATE "PageVisit" SET "path" = '/users/[handle]'
  WHERE "path" ~ '^/users/[^/?#]+$' AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin");
UPDATE "PageVisit" SET "referrer" = NULL
  WHERE "referrer" IS NOT NULL AND "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin");
