// The 个人主页 tab bar: link tabs (`?tab=`, default tab carries no param) over
// the motion kit's TabBar, so the hairline indicator slides between tabs across
// soft navigations and nothing else animates. Server component — builds the
// items (labels, counts, 仅自己可见 markers, the 工作台 attention badge).

import { useTranslations } from 'next-intl';
import { EyeOff } from 'lucide-react';
import { TabBar, type TabItem } from '@/components/motion/TabBar';
import type { ProfileTab } from '@/lib/profile/shared';
import { isHiddenButVisible, type ProfileViewer, type SectionCounts } from '@/lib/profile/queries';
import { ActiveTabScroller } from './ActiveTabScroller';
import { profileHref } from './profile-href';

export function ProfileTabs({
  handle,
  tabs,
  active,
  counts,
  viewer,
  attention,
}: {
  handle: string;
  tabs: ProfileTab[];
  active: ProfileTab;
  counts: SectionCounts;
  viewer: ProfileViewer;
  attention: number;
}) {
  const t = useTranslations('profile');
  const items: TabItem[] = tabs.map((tab) => {
    const href = profileHref(handle, { tab, visitor: viewer.previewAsVisitor });
    if (tab === 'overview') return { key: tab, href, label: t('tab_overview') };
    if (tab === 'workspace') {
      return {
        key: tab,
        href,
        label: (
          <span className="inline-flex items-center gap-1.5">
            {t('tab_workspace')}
            {attention > 0 && (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-semibold leading-none text-white"
                aria-label={t('tab_workspace_attention', { count: attention })}
              >
                {attention > 99 ? '99+' : attention}
              </span>
            )}
          </span>
        ),
      };
    }
    const hidden = isHiddenButVisible(viewer, tab);
    return {
      key: tab,
      href,
      count: counts[tab],
      label: (
        <span className="inline-flex items-center gap-1">
          {t(`tab_${tab}`)}
          {hidden && (
            <span title={t('hidden_badge')} aria-label={t('hidden_badge')}>
              <EyeOff className="h-3 w-3 text-zinc-400" aria-hidden />
            </span>
          )}
        </span>
      ),
    };
  });

  // The kit's bar is a horizontal scroll box with its own `border-b`, and its
  // hairline indicator sits at `-bottom-px` — inside that border, where the
  // scroll box clips it (overflow-x:auto makes overflow-y clip too), so the
  // active tab had no visible mark. Here the base rule is drawn by the wrapper
  // instead, the bar's border is dropped and a 1px bottom padding row gives the
  // indicator room INSIDE the clip, painted over the wrapper's rule.
  return (
    <ActiveTabScroller active={active} className="relative -mx-6 sm:mx-0">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-zinc-200 dark:bg-zinc-800" />
      <TabBar
        tabs={items}
        active={active}
        id={`profile-${handle}`}
        ariaLabel={t('page_tabs_aria')}
        className="scroll-thin !border-b-0 px-6 pb-px sm:px-0"
      />
    </ActiveTabScroller>
  );
}
