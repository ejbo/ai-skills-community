// Video-board access control. Separate from lib/access.ts (which is skill-shaped)
// on purpose — never import skill access logic here.
//
// Posture (per spec): the whole board is login-walled. Any logged-in user may
// watch published public/unlisted videos. draft / processing / archived status
// and `private` visibility are visible only to the uploader or a holder of the
// matching permission — `videos` for long videos, `shorts` for shorts (they
// share the Video table, so every privileged decision branches on `isShort`).

import { auth } from '@/lib/auth';
import { hasPermission, type PermissionHolder } from '@/lib/permissions';

export interface VideoActor {
  id: string;
  /** `videos` permission — long-video management + comment moderation. */
  canManageVideos: boolean;
  /** `shorts` permission — shorts management + comment moderation. */
  canManageShorts: boolean;
  /** `identity` permission — pass to toPublicAuthor. */
  canSeeIdentity: boolean;
}

export function videoActorFrom(user: ({ id: string } & PermissionHolder) | null | undefined): VideoActor | null {
  if (!user) return null;
  return {
    id: user.id,
    canManageVideos: hasPermission(user, 'videos'),
    canManageShorts: hasPermission(user, 'shorts'),
    canSeeIdentity: hasPermission(user, 'identity'),
  };
}

export async function getVideoActor(): Promise<VideoActor | null> {
  const session = await auth();
  return videoActorFrom(session?.user);
}

type VideoGate = {
  status: string;
  visibility: string;
  uploaderId: string;
  deletedAt: Date | null;
  /** Shorts and long videos are moderated by different permissions. Omitted ⇒ long video. */
  isShort?: boolean;
};

/** May the actor manage THIS video (uploader, or the permission for its kind)? */
export function canManageVideo(video: Pick<VideoGate, 'isShort'>, actor: VideoActor | null): boolean {
  if (!actor) return false;
  return video.isShort ? actor.canManageShorts : actor.canManageVideos;
}

export function isVideoPrivileged(video: VideoGate, actor: VideoActor | null): boolean {
  if (!actor) return false;
  return video.uploaderId === actor.id || canManageVideo(video, actor);
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

/** Long-video management (/manage/videos, admin PATCH/DELETE, summary). */
export function canManageVideos(actor: VideoActor | null): boolean {
  return Boolean(actor?.canManageVideos);
}

/**
 * Comment moderation: the author, or the moderator of the comment's video kind.
 * VideoComment rows are shared by long videos and shorts, so callers MUST pass
 * the parent video's `isShort`.
 */
export function canModerateComment(
  actor: VideoActor | null,
  authorId: string,
  video: Pick<VideoGate, 'isShort'>,
): boolean {
  if (!actor) return false;
  return actor.id === authorId || canManageVideo(video, actor);
}
