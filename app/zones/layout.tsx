import { requireUser } from '@/lib/admin';
import { PreviewProvider } from '@/components/zones/preview/PreviewProvider';

// /zones/** is login-walled (same model as /votes and /videos): zone media
// streams from /api/zones/media with auth(), so an anonymous page would be a
// wall of 401 images. PreviewProvider hosts the right-side preview drawer that
// embed cards / attachments open anywhere under the section.
export default async function ZonesLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <PreviewProvider>{children}</PreviewProvider>;
}
