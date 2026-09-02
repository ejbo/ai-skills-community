// 技术专区 — lead roles (主版主 / 版主) keyed by handle. Plain module (no
// 'use client'): RSC pages build the map, client leaves read it. Handles are
// already public in every author payload, so nothing new travels to a viewer;
// department / lab / email never enter this structure.

export type LeadRole = 'owner' | 'moderator';

/** handle → role. */
export type LeadRoles = Readonly<Record<string, LeadRole>>;

/** Owner wins on collision; empty handles are ignored. Handles compare exactly (never lowercased). */
export function buildLeadRoles(ownerHandle: string, moderatorHandles: readonly string[]): LeadRoles {
  const out: Record<string, LeadRole> = {};
  for (const h of moderatorHandles) {
    if (typeof h === 'string' && h.trim()) out[h] = 'moderator';
  }
  if (typeof ownerHandle === 'string' && ownerHandle.trim()) out[ownerHandle] = 'owner';
  return out;
}

export function leadRoleOf(leads: LeadRoles | null | undefined, handle: string): LeadRole | null {
  if (!leads || !handle) return null;
  return Object.prototype.hasOwnProperty.call(leads, handle) ? leads[handle] : null;
}
