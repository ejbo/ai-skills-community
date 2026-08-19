import { requireUser } from '@/lib/admin';

// The whole vote surface is login-walled (same model as /videos): entry media
// streams from /api/votes/media with auth() + unguessable capability keys, so
// the pages that render those URLs must sit behind login too — an anonymous
// gallery would show a wall of 401 images.
export default async function VotesLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
