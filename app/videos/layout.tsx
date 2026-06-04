import { requireUser } from '@/lib/admin';

// The whole video board is login-walled. Per-page breadcrumbs (under the navbar)
// are rendered by each page via <VideoBreadcrumb/>, so the section path is shown
// with real labels (and parent crumbs are clickable to go back up a level).
export default async function VideosLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
