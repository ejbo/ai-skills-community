-- 长视频字幕 + 封面版式/裁切 (2026-09-18)。全部是「加列」，可重复执行。
--
-- 1) 封面契约 (lib/media/cover-pos.ts)：视频封面与技术专区帖子封面共用同一套三态——
--    aspect 'landscape' | 'portrait'（版式），pos '' = 居中裁切 / 'contain' = 完整显示
--    （模糊铺底）/ 'x% y%' = 取景位置。用 TEXT 而不是 enum：取值集合由代码里的
--    parseCoverAspect / parseCoverPos 把关，以后多一个展示面不需要 ALTER TYPE。
--    老数据落在默认值上（横版 + 居中裁切）= 和改动前的渲染完全一致。
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "posterAspect" TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "posterPos" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ZonePost" ADD COLUMN IF NOT EXISTS "coverAspect" TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE "ZonePost" ADD COLUMN IF NOT EXISTS "coverPos" TEXT NOT NULL DEFAULT '';

-- 2) 悬停预览片段取自原片的哪一段 {start,end,cover,duration}（与 UserProfile.cardMediaClip
--    同一个 StoredClip 形状），让后台编辑页能在原位置重新打开截取器。
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "previewClip" JSONB;

-- 3) 由字幕派生的带时间戳文稿，给 AI 摘要/问答当背景。只由字幕管线写入，从不手改；
--    上传者手填的 transcriptText 仍然优先。
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "subtitleTranscript" TEXT;

-- 4) 字幕来源：管理员手工上传/替换过字幕轨道后置 true。替换视频源文件时，只有 false
--    （全是机器生成的）才会自动重新生成 —— 人工校对过的字幕是劳动成果，不能被静默覆盖。
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "subtitleManual" BOOLEAN NOT NULL DEFAULT false;
