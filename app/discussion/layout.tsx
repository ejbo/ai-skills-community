import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// 讨论区正文可以引用站内内容（[embed:kind:ref]，与技术专区同一套契约），
// PreviewProvider 就是那些卡片点开的右侧预览抽屉。这里刻意 **不** 加登录墙 ——
// 讨论区对未登录访客可读，而 PreviewProvider 自己不需要 session（未登录时
// 卡片的取数会 401，退化成不可用状态，这是 EmbedCard 已有的行为）。
export default function DiscussionLayout({ children }: { children: React.ReactNode }) {
  return <PreviewProvider>{children}</PreviewProvider>;
}
