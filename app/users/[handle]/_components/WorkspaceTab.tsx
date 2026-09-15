// 工作台 tab of the merged 个人主页 (it replaced /dashboard, which now redirects here).
//
// FIXED props (the profile page renders <WorkspaceTab userId handle /> for the
// OWNER only). The page's decision is not trusted blindly: this component
// re-reads the session and renders nothing unless the signed-in user IS
// `userId` — every query behind it reads that user's private rows (drafts,
// incoming requests, subscriptions), so a wrong caller must fail closed.

import { auth } from '@/lib/auth';
import { loadWorkspaceData } from '@/lib/profile/workspace';
import { WorkspaceView } from './workspace/WorkspaceView';

export async function WorkspaceTab({ userId, handle }: { userId: string; handle: string }) {
  const session = await auth();
  const viewer = session?.user;
  if (!viewer?.id || viewer.id !== userId) return null;
  // `handle` is part of the fixed contract; links inside the tab are all to the
  // owner's own surfaces and need no handle today.
  void handle;

  const data = await loadWorkspaceData(userId, viewer);
  return <WorkspaceView data={data} />;
}
