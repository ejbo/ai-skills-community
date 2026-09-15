// 徽章图标 — BadgeIcon key (lib/profile/shared.ts) → lucide component.
// Shared by the badge chip, the hover card, the profile page and the admin
// tag manager, so an icon an admin picks looks the same everywhere. Server-safe.

import {
  Award,
  BadgeCheck,
  BookOpen,
  Code2,
  Crown,
  Flame,
  Gem,
  GraduationCap,
  Heart,
  Lightbulb,
  Medal,
  Mic,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BadgeIcon } from '@/lib/profile/shared';

export const BADGE_ICON_COMPONENTS: Record<BadgeIcon, LucideIcon> = {
  award: Award,
  'badge-check': BadgeCheck,
  star: Star,
  crown: Crown,
  shield: Shield,
  flame: Flame,
  sparkles: Sparkles,
  trophy: Trophy,
  medal: Medal,
  gem: Gem,
  rocket: Rocket,
  book: BookOpen,
  code: Code2,
  mic: Mic,
  heart: Heart,
  zap: Zap,
  target: Target,
  lightbulb: Lightbulb,
  graduation: GraduationCap,
  users: Users,
};

/** The icon a badge renders: its own, else a default per source (role → crown, auto → badge-check, manual → award). */
export function badgeIconFor(badge: { icon: BadgeIcon | null; kind: 'manual' | 'auto' | 'role' }): LucideIcon {
  if (badge.icon) return BADGE_ICON_COMPONENTS[badge.icon];
  return badge.kind === 'role' ? Crown : badge.kind === 'auto' ? BadgeCheck : Award;
}
