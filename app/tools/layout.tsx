import { MotionConfig } from 'framer-motion';
import { requireUser } from '@/lib/admin';
import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// /tools/** — 工具中心。报告详情页的预览和帖子页 / 分享页用同一个 ReportArticle，「看原文」「知识库文档」、
// 文件卡都要开在右侧面板里，所以这里也挂 DOCK 模式的 PreviewProvider（缺了它 usePreview() 是 no-op）。
export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <MotionConfig reducedMotion="user">
      <PreviewProvider mode="dock">{children}</PreviewProvider>
    </MotionConfig>
  );
}
