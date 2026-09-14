-- 版块主题色 (2026-09-11)。版主可为版块挑一个主题色（#rrggbb），用于横幅底色、
-- 图标环与首字母图标 —— 是版块自己的「材料」颜色，不是页面 chrome。
-- NULL ⇒ 按版块名哈希出的身份色（app/zones/_components/zone-color.ts）。
ALTER TABLE "Zone" ADD COLUMN "themeColor" TEXT;
