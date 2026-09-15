'use client';

// 设置 → 隐私 → 主页板块. The whole `UserProfile.layout` ({order, hidden}) as one
// list: drag the grip (or ↑/↓ — the keyboard path) to reorder, flip 对外展示 per
// section, 恢复默认, and ONE 保存 → PUT /api/me/profile {layout}. The server
// re-runs `parseProfileLayout`, so the client only ever sends what it shows.
//
// A hidden section is not deleted content — the owner and `identity` holders
// still see it on the profile (marked 仅自己可见); other viewers' queries never
// run for it. LOGIN_ONLY sections (视频 / 专区 / 投票) carry a note because an
// anonymous visitor never gets them regardless of this switch.
// 概览 and 工作台 are not in the list: 概览 is always first, 工作台 is owner-only.
//
// Keyboard reorder keeps focus on the pressed arrow (../_components/MoveButton).
// A saved layout changes the hover card's stats, so it drops this tab's cached card.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Clapperboard,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Library,
  Lock,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Megaphone,
  RotateCcw,
  Sparkles,
  Vote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { invalidateUserCard } from '@/components/user/UserHoverCard';
import { SPRING_SNAPPY } from '@/lib/motion';
import {
  defaultProfileLayout,
  isDefaultProfileLayout,
  isLoginOnlySection,
  parseProfileLayout,
  type ProfileSection,
} from '@/lib/profile/shared';
import { SaveBar } from '../_components/SaveBar';
import { MoveButton } from '../_components/MoveButton';
import { Switch } from '../_components/Switch';
import { layoutsEqual, moveItem, toggleSectionHidden, type LayoutDraft } from '../_components/editor-shared';
import { useUnsavedGuard } from '../_components/useUnsavedGuard';
import { BTN_GHOST, BTN_SECONDARY } from '../_components/ui';

const SECTION_ICONS: Record<ProfileSection, LucideIcon> = {
  skills: Sparkles,
  docs: BookOpen,
  posts: MessageSquareText,
  topics: MessagesSquare,
  videos: Clapperboard,
  zones: LayoutGrid,
  events: CalendarDays,
  votes: Vote,
  feedback: Megaphone,
  comments: MessageCircle,
  shelf: Library,
};

export function ProfileLayoutEditor({ initial, handle }: { initial: LayoutDraft; handle: string }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const reduce = useReducedMotion();
  const [base, setBase] = useState<LayoutDraft>(() => parseProfileLayout(initial));
  const [layout, setLayout] = useState<LayoutDraft>(base);
  const [saving, setSaving] = useState(false);

  const dirty = !layoutsEqual(layout, base);
  useUnsavedGuard(dirty, t('pf_leave_confirm'));
  const shownCount = layout.order.length - layout.hidden.length;

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layout }),
      });
      if (!res.ok) {
        pushToast('error', t('save_failed'));
        return;
      }
      const fresh = (await res.json().catch(() => null)) as { layout?: unknown } | null;
      const next = parseProfileLayout(fresh?.layout ?? layout);
      setBase(next);
      setLayout(next);
      invalidateUserCard(handle);
      pushToast('success', t('layout_saved'));
      router.refresh();
    } catch {
      pushToast('error', t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{t('layout_title')}</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{t('layout_desc')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!isDefaultProfileLayout(layout) && (
            <button type="button" onClick={() => setLayout(defaultProfileLayout())} className={`${BTN_GHOST} text-xs`}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('layout_reset')}
            </button>
          )}
          <Link href={`/users/${encodeURIComponent(handle)}?as=visitor`} className={`${BTN_SECONDARY} h-8 text-xs`}>
            {t('layout_preview_visitor')}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{t('layout_shown_count', { shown: shownCount, total: layout.order.length })}</span>
        <span className="hidden sm:inline">{t('layout_col_public')}</span>
      </div>

      <Reorder.Group
        as="ol"
        axis="y"
        values={layout.order}
        onReorder={(order: ProfileSection[]) => setLayout((l) => ({ ...l, order }))}
        className="mt-2 space-y-1.5"
      >
        {layout.order.map((section, i) => (
          <SectionRow
            key={section}
            section={section}
            index={i}
            count={layout.order.length}
            hidden={layout.hidden.includes(section)}
            reduce={!!reduce}
            onToggle={() => setLayout((l) => toggleSectionHidden(l, section))}
            onMove={(to) => setLayout((l) => ({ ...l, order: moveItem(l.order, i, to) }))}
          />
        ))}
      </Reorder.Group>

      <p className="mt-3 text-xs leading-relaxed text-muted">{t('layout_footnote')}</p>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setLayout(base)} className="mt-4" />
    </div>
  );
}

function SectionRow({
  section,
  index,
  count,
  hidden,
  reduce,
  onToggle,
  onMove,
}: {
  section: ProfileSection;
  index: number;
  count: number;
  hidden: boolean;
  reduce: boolean;
  onToggle: () => void;
  onMove: (to: number) => void;
}) {
  const t = useTranslations('settings');
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const Icon = SECTION_ICONS[section];
  const loginOnly = isLoginOnlySection(section);
  const labelId = `layout-${section}-label`;
  const label = t(`layout_sec_${section}`);

  return (
    <Reorder.Item
      as="li"
      value={section}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      whileDrag={reduce ? undefined : { scale: 1.01 }}
      transition={reduce ? { duration: 0 } : SPRING_SNAPPY}
      className={`relative flex select-none items-center gap-2 rounded-xl border px-2 py-2 sm:gap-3 sm:px-2.5 ${
        dragging
          ? 'z-10 border-zinc-300 bg-white shadow-lg dark:border-zinc-600 dark:bg-zinc-900'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
      }`}
    >
      {/* Grip is pointer-only (out of the tab order); ↑/↓ are the keyboard path. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        title={t('layout_drag')}
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
        }}
        style={{ touchAction: 'none' }}
        className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-zinc-300 transition hover:text-zinc-600 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-300"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="hidden w-5 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400 sm:block dark:text-zinc-500">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          hidden
            ? 'bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600'
            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
        }`}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            id={labelId}
            className={`max-w-full truncate text-sm font-medium ${hidden ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}
          >
            {label}
          </span>
          {hidden && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-zinc-500">
              <EyeOff className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('layout_only_me')}</span>
            </span>
          )}
          {loginOnly && (
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-px text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              title={t('layout_login_only_hint')}
            >
              <Lock className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{t('layout_login_only')}</span>
            </span>
          )}
        </p>
        <p className="mt-0.5 hidden truncate text-xs text-muted sm:block">{t(`layout_sec_${section}_desc`)}</p>
      </div>
      <Switch checked={!hidden} onChange={onToggle} label={t('layout_toggle', { section: label })} />
      <div className="flex shrink-0 items-center">
        <MoveButton
          atEnd={index === 0}
          onMove={() => onMove(index - 1)}
          label={t('layout_move_up', { section: label })}
          className="h-8 w-7 sm:w-8"
        >
          <ArrowUp className="h-4 w-4" />
        </MoveButton>
        <MoveButton
          atEnd={index === count - 1}
          onMove={() => onMove(index + 1)}
          label={t('layout_move_down', { section: label })}
          className="h-8 w-7 sm:w-8"
        >
          <ArrowDown className="h-4 w-4" />
        </MoveButton>
      </div>
    </Reorder.Item>
  );
}
