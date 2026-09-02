'use client';

// The ONLY way a lead role (主版主 / 版主) reaches a byline — post rows, post
// header, comments, the notice band, the moderators card. Owner = filled ink
// pill; moderator = outlined mono pill. Labels come from the shared
// `labels.zoneRole.*` taxonomy keys.

import { useTranslations } from 'next-intl';
import type { LeadRole } from '@/lib/zones/lead-roles';
import { PILL_INK, PILL_MONO } from './ui';

export function RolePill({ role, className = '' }: { role: LeadRole; className?: string }) {
  const tl = useTranslations('labels');
  if (role === 'owner') return <span className={`${PILL_INK} ${className}`}>{tl('zoneRole.owner')}</span>;
  return <span className={`${PILL_MONO} ${className}`}>{tl('zoneRole.moderator')}</span>;
}
