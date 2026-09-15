-- 个人主页与名片 (2026-09-14)。
-- 「我的面板」并入个人主页；主页板块从 6 个开关扩展成可排序、可隐藏的布局；
-- 用户可自定义名片（照片/短视频、样式、文字），悬停用户即显示名片。
--
-- 1) UserProfile — 与 User 1:1。JSON 列各有唯一的 sanitizer（lib/profile/shared.ts），
--    读写两侧都会重新清洗。名片媒体只存 KEY（形状 + 磁盘 + 唯一校验），URL 由服务端重建。
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "aboutMd" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "links" JSONB NOT NULL DEFAULT '[]',
    "layout" JSONB,
    "pins" JSONB NOT NULL DEFAULT '[]',
    "card" JSONB NOT NULL DEFAULT '{}',
    "cardMediaKind" TEXT,
    "cardMediaKey" TEXT,
    "cardPosterKey" TEXT,
    "cardLoopKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "UserProfile_cardMediaKey_key" ON "UserProfile"("cardMediaKey");
CREATE UNIQUE INDEX "UserProfile_cardPosterKey_key" ON "UserProfile"("cardPosterKey");
CREATE UNIQUE INDEX "UserProfile_cardLoopKey_key" ON "UserProfile"("cardLoopKey");

ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 回填布局：只为「关过至少一个旧开关」的成员写一行，其余成员 layout 保持 NULL，
--    由 parseProfileLayout 按旧开关（全开）推出默认布局。showProfilePosts 过去同时管
--    动态与论坛话题，所以拆成 posts + topics 两个板块时两边都继承它。
--    `db push` 部署不会执行这段 —— 那种情况下 layout 为 NULL，读侧的旧开关兜底同样生效，
--    不会丢隐私设置。
INSERT INTO "UserProfile" ("userId", "layout", "updatedAt")
SELECT u."id",
       jsonb_build_object(
         'order', '[]'::jsonb,
         'hidden', to_jsonb(ARRAY_REMOVE(ARRAY[
           CASE WHEN NOT u."showProfileSkills"   THEN 'skills'   END,
           CASE WHEN NOT u."showProfileDocs"     THEN 'docs'     END,
           CASE WHEN NOT u."showProfilePosts"    THEN 'posts'    END,
           CASE WHEN NOT u."showProfilePosts"    THEN 'topics'   END,
           CASE WHEN NOT u."showProfileComments" THEN 'comments' END,
           CASE WHEN NOT u."showProfileShelf"    THEN 'shelf'    END,
           CASE WHEN NOT u."showProfileEvents"   THEN 'events'   END,
           -- 六个旧开关全关 = 「什么都不展示」：之后新增的板块也一并隐藏（与 layoutFromLegacyFlags 一致）。
           CASE WHEN NOT (u."showProfileSkills" OR u."showProfileDocs" OR u."showProfilePosts"
                          OR u."showProfileComments" OR u."showProfileShelf" OR u."showProfileEvents")
                THEN 'videos' END,
           CASE WHEN NOT (u."showProfileSkills" OR u."showProfileDocs" OR u."showProfilePosts"
                          OR u."showProfileComments" OR u."showProfileShelf" OR u."showProfileEvents")
                THEN 'zones' END,
           CASE WHEN NOT (u."showProfileSkills" OR u."showProfileDocs" OR u."showProfilePosts"
                          OR u."showProfileComments" OR u."showProfileShelf" OR u."showProfileEvents")
                THEN 'votes' END,
           CASE WHEN NOT (u."showProfileSkills" OR u."showProfileDocs" OR u."showProfilePosts"
                          OR u."showProfileComments" OR u."showProfileShelf" OR u."showProfileEvents")
                THEN 'feedback' END
         ], NULL))
       ),
       CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT (u."showProfileSkills" AND u."showProfileDocs" AND u."showProfilePosts"
           AND u."showProfileComments" AND u."showProfileShelf" AND u."showProfileEvents")
ON CONFLICT ("userId") DO NOTHING;

-- 3) 徽章图标（BADGE_ICONS 里的 key；NULL ⇒ 按 kind 的默认图标）。
ALTER TABLE "UserTag" ADD COLUMN "icon" TEXT;

-- 4) 主页「评论」板块按作者查三张评论表 —— 之前没有作者索引，是全表扫描。
CREATE INDEX "PostComment_authorId_createdAt_idx" ON "PostComment"("authorId", "createdAt");
CREATE INDEX "DiscussionReply_authorId_createdAt_idx" ON "DiscussionReply"("authorId", "createdAt");
CREATE INDEX "FeedbackComment_authorId_createdAt_idx" ON "FeedbackComment"("authorId", "createdAt");
