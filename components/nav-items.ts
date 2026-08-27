// The navbar's destination catalog — plain module (no 'use client', no
// next-intl) so both the server header and the client overflow menu can read
// it. Labels are i18n KEYS in the `nav` namespace; the renderer translates.
//
// `primary` items compete for the inline row and spill into the overflow menu
// when they no longer fit (see NavBarInner). `stashed` items are ALWAYS in the
// menu — that is a product decision, not a width one: 投票 / 文档 / 意见反馈 are
// destinations people visit occasionally, and keeping them out of the row is
// what buys the row enough space to survive the English labels.

import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  FileText,
  Layers,
  MessageSquarePlus,
  MessagesSquare,
  Sparkles,
  Vote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  /** Key inside the `nav` i18n namespace. */
  key: string;
  Icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/skills', key: 'browse', Icon: Sparkles },
  { href: '/videos', key: 'videos', Icon: Clapperboard },
  { href: '/library', key: 'library', Icon: BookOpen },
  { href: '/discussion', key: 'discussion', Icon: MessagesSquare },
  { href: '/zones', key: 'zones', Icon: Layers },
  { href: '/events', key: 'events', Icon: CalendarDays },
];

export const STASHED_NAV: NavItem[] = [
  { href: '/votes', key: 'votes', Icon: Vote },
  { href: '/docs', key: 'docs', Icon: FileText },
  { href: '/feedback', key: 'feedback', Icon: MessageSquarePlus },
];
