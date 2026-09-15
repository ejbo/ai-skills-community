import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { workspaceHref } from '@/app/users/[handle]/_components/workspace/href';

export const dynamic = 'force-dynamic';

// /dashboard is RETIRED: 我的面板 merged into the 个人主页 as its owner-only 工作台
// tab (app/users/[handle]/_components/WorkspaceTab.tsx). The route is KEPT, not
// deleted — bookmarks, old links and muscle memory still land here, and
// tests/page-visit.test.ts pins `app/**/page.tsx` ↔ PAGE_NAMES in both directions
// (the same reason /auth/signup survives as a redirect).
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/dashboard'));
  // The JWT always carries the handle; a malformed session gets the homepage
  // rather than a /users/undefined 404.
  redirect(session.user.handle ? workspaceHref(session.user.handle) : '/');
}
