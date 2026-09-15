// Where 工作台 lives. Import-free so client components (DeleteSkillButton) and
// server pages (/dashboard redirect, the skill manage breadcrumb) build the SAME
// link — /dashboard is retired, and a hand-written copy of this path is exactly
// how one of them would drift back to it.

/** The owner's 工作台 tab on their merged 个人主页. */
export function workspaceHref(handle: string): string {
  return `/users/${encodeURIComponent(handle)}?tab=workspace`;
}
