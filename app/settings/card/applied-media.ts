// 名片媒体 — what this tab last applied, for the page instance the server rendered.
//
// CardMediaField applies media immediately and deliberately does NOT call
// router.refresh() afterwards (it wiped unsaved 名片 edits and focus — see there).
// Without a refresh, Next's client Router Cache still holds the RSC payload the
// page was rendered from: a soft navigation back to 设置 → 名片 within the dynamic
// stale time (30 s in Next 14.2), or a browser Back at any time, re-mounts the
// editor with THAT `settings` object — media that was just replaced or removed,
// URLs of files that were unlinked, a 剪辑片段 source that is gone.
//
// The cached payload is the SAME object (the router re-renders the stored React
// tree), while a fresh server render always deserialises a new one. So the last
// applied media is remembered against the exact `settings` object it supersedes,
// and only a re-mount on that very object reads it back; any fresh render wins.
// Module state: one tab, no persistence, nothing to clean up.

import type { OwnProfileSettings, ProfileCardMedia } from '@/lib/profile/types';
import type { CardVideoSource } from './CardMediaField';

interface AppliedMedia {
  base: OwnProfileSettings;
  media: ProfileCardMedia | null;
  source: CardVideoSource | null;
}

let applied: AppliedMedia | null = null;

/** Record media the editor applied on top of the server-rendered `base` settings. */
export function rememberAppliedMedia(base: OwnProfileSettings, media: ProfileCardMedia | null, source: CardVideoSource | null): void {
  applied = { base, media, source };
}

/** The media applied over exactly this `settings` object (a Router Cache re-mount), else null. */
export function appliedMediaFor(base: OwnProfileSettings): { media: ProfileCardMedia | null; source: CardVideoSource | null } | null {
  return applied && applied.base === base ? { media: applied.media, source: applied.source } : null;
}
