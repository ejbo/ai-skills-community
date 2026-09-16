// Plain module on purpose: the RSC page calls `discussionTabOf`, and a helper
// exported from a 'use client' file is only a client REFERENCE on the server
// (calling it throws "is not a function" — see CLAUDE.md, 技术专区 trap).

export type DiscussionTab = 'all' | 'posts' | 'forum';

/**
 * The 动态 hub's tab from `?tab=`. 全部 is the default and has NO param, so
 * the nav panel, the tab strip and the page agree on one canonical URL each.
 */
export function discussionTabOf(raw: string | null | undefined): DiscussionTab {
  return raw === 'forum' ? 'forum' : raw === 'posts' ? 'posts' : 'all';
}
