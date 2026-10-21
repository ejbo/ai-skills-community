import { MotionConfig } from 'framer-motion';
import { requireUser } from '@/lib/admin';
import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// /reports/** — 报告分享页（docs/contracts/reports.md §3b）。和 /zones 一样挂 DOCK 模式的 PreviewProvider：
// 「看原文」「知识库文档」、文件卡都开在右侧面板里。没有它 usePreview() 是 no-op——2026-10-21 分享页上
// 「看原文」点了没反应就是因为这里缺了 provider。登录墙同 /zones。
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <MotionConfig reducedMotion="user">
      <PreviewProvider mode="dock">{children}</PreviewProvider>
    </MotionConfig>
  );
}
