import { MotionConfig } from 'framer-motion';
import { requireUser } from '@/lib/admin';
import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// /zones/** is login-walled (same model as /votes and /videos): zone media
// streams from /api/zones/media with auth(), so an anonymous page would be a
// wall of 401 images. PreviewProvider in DOCK mode hosts the non-modal,
// resizable reading panel that embed cards / attachments open anywhere under
// the section (below lg / on a coarse pointer it falls back to the modal
// drawer). MotionConfig reducedMotion="user" is the section-wide safety net —
// transforms go instant for reduced-motion users even where a component forgot
// to gate; the explicit `reduce ? 0 : …` on width tweens is still needed
// because width is not a transform. (MotionConfig ships "use client".)
export default async function ZonesLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <MotionConfig reducedMotion="user">
      <PreviewProvider mode="dock">{children}</PreviewProvider>
    </MotionConfig>
  );
}
