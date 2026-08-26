// 技术专区 — settings-page tab policy. Plain module (NO 'use client'): the RSC page calls
// settingsTabsFor() on the server, and a function exported from a client-boundary module is
// only a client reference there ("is not a function" at runtime, invisible to tsc).

import type { ZoneDetailView } from '@/lib/zones/types';

export type SettingsTab = 'basic' | 'access' | 'roles' | 'danger';

export function settingsTabsFor(zone: ZoneDetailView): SettingsTab[] {
  const a = zone.access;
  const out: SettingsTab[] = [];
  if (a.canManage) out.push('basic', 'access');
  if (a.canManageRoles) out.push('roles');
  if (a.isOwner || a.siteAdmin) out.push('danger');
  return out;
}
