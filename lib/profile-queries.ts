// LEGACY shim — the 个人主页 moved to lib/profile/* on 2026-09-14.
//
//   viewer model, section counts + loaders  → lib/profile/queries.ts
//   精选置顶 (pins)                           → lib/profile/pins.ts
//   板块顺序 / 对外隐藏 (UserProfile.layout)   → lib/profile/shared.ts#parseProfileLayout
//
// The six per-section queries that used to live here were deleted with the old
// page: they carried the pre-merge rules (doc comments shown to anonymous
// visitors, a docs rule that disagreed with browse and the hover card), and
// nothing may drift back onto them. Only the select fragment for the six
// read-only `User.showProfile*` fallback flags is still exported, for callers
// that have not moved to LEGACY_PROFILE_FLAGS_SELECT yet.

import { LEGACY_PROFILE_FLAGS_SELECT } from '@/lib/profile/shared';

/** @deprecated use LEGACY_PROFILE_FLAGS_SELECT from lib/profile/shared.ts. */
export const PROFILE_VISIBILITY_SELECT = LEGACY_PROFILE_FLAGS_SELECT;
