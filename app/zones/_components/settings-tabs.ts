// 技术专区 — settings-page tab policy. Plain module (NO 'use client'): the RSC page calls
// settingsTabsFor() on the server, and a function exported from a client-boundary module is
// only a client reference there ("is not a function" at runtime, invisible to tsc).
//
// Tab order is the order a 版主 reads the page in: what the zone IS (basic), who may enter
// (access), how content is organised (columns), who may do what (roles), and last the
// irreversible actions. `columns` gates on `canModerate` — the column routes gate on
// `moderate`, not `manage`, so a 版主 without `manage` still curates the taxonomy.

import type { ZoneDetailView } from '@/lib/zones/types';

export type SettingsTab = 'basic' | 'access' | 'columns' | 'roles' | 'danger';

export function settingsTabsFor(zone: ZoneDetailView): SettingsTab[] {
  const a = zone.access;
  const out: SettingsTab[] = [];
  if (a.canManage) out.push('basic', 'access');
  if (a.canModerate) out.push('columns');
  if (a.canManageRoles) out.push('roles');
  if (a.isOwner || a.siteAdmin) out.push('danger');
  return out;
}
