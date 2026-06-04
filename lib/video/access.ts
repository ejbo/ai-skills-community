// Video-board access control. Separate from lib/access.ts (which is skill-shaped)
// on purpose — never import skill access logic here.
//
// Posture (per spec): the whole board is login-walled. Any logged-in user may
// watch published public/unlisted videos. draft / processing / archived status
// and `private` visibility are visible only to the uploader or an admin.

import { auth } from '@/lib/auth';

export interface VideoActor {
  id: string;
  isAdmin: boolean;
}

export async function getVideoActor(): Promise<VideoActor | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, isAdmin: session.user.isAdmin };
}

type VideoGate = {
  status: string;
  visibility: string;
  uploaderId: string;
  deletedAt: Date | null;
};

export function isVideoPrivileged(video: VideoGate, actor: VideoActor | null): boolean {
  if (!actor) return false;
  return actor.isAdmin || video.uploaderId === actor.id;
}

/** Login wall + visibility. Returns true if the actor may see this video at all. */
export function canViewVideo(video: VideoGate, actor: VideoActor | null): boolean {
  if (!actor) return false; // login wall
  if (isVideoPrivileged(video, actor)) return true;
  if (video.deletedAt) return false;
  if (video.status !== 'published') return false;
  // published: public + unlisted are watchable by any logged-in user; private is not.
  return video.visibility === 'public' || video.visibility === 'unlisted';
}

/** Whether the actor may receive the playable video URL (same rule as view). */
export function canPlayVideo(video: VideoGate, actor: VideoActor | null): boolean {
  return canViewVideo(video, actor);
}

export function canManageVideos(actor: VideoActor | null): boolean {
  return Boolean(actor?.isAdmin);
}

export function canModerateComment(actor: VideoActor | null, authorId: string): boolean {
  if (!actor) return false;
  return actor.isAdmin || actor.id === authorId;
}
