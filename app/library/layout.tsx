import { MotionConfig } from 'framer-motion';
import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// /library hosts the same docked reading panel as /zones (PreviewProvider in
// DOCK mode): 最新评论与批注 opens a doc page or the reader IN the panel, landed on
// the comment / the highlighted passage. Not login-walled — the rail only lists
// activity on public docs, and the framed page runs its own gates. The reader
// itself is `fixed inset-0`, so it simply covers the dock while open.
export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <PreviewProvider mode="dock">{children}</PreviewProvider>
    </MotionConfig>
  );
}
