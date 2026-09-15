// Per-section presentation constants for the 个人主页 (icons match the navbar's
// destination icons so a section reads as "that board" at a glance). Plain
// module: server components and client leaves both import it.

import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Layers,
  LibraryBig,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  Newspaper,
  Sparkles,
  Vote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProfileSection } from '@/lib/profile/shared';

export const SECTION_ICONS: Record<ProfileSection, LucideIcon> = {
  skills: Sparkles,
  docs: BookOpen,
  posts: Newspaper,
  topics: MessagesSquare,
  videos: Clapperboard,
  zones: Layers,
  events: CalendarDays,
  votes: Vote,
  feedback: MessageSquarePlus,
  comments: MessageCircle,
  shelf: LibraryBig,
};

/**
 * Where the owner goes to create content for an empty section. Skills point at
 * /skills on purpose: its 上传 Skill button is the ONE upload entry (CLAUDE.md).
 */
export const SECTION_CREATE_HREF: Record<ProfileSection, string> = {
  skills: '/skills',
  docs: '/library',
  posts: '/discussion',
  topics: '/discussion/topics/new',
  videos: '/videos/shorts?upload=1',
  zones: '/zones',
  events: '/events/new',
  votes: '/votes/new',
  feedback: '/feedback',
  comments: '/discussion',
  shelf: '/library',
};
