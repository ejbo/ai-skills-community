'use client';

// 报告帖子的合著者——分享到版块之后随时加 / 删（owner 2026-10-21：「如果当时没有添加，后面就无法再进行添加了，
// 这个要随时都可以去添加和删除」）。两种来源：聊天记录里匹配到站内账号的发言人（一键勾选），以及全站搜索（PeoplePicker，
// 和帖子编辑器里的合著者 picker 同一个）。保存 = PUT /api/tools/chat-report/[id]/coauthors 整体替换；
// 服务端走 updateZonePost 的 coauthorIds 分支，新加的人收到通知。

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { PeoplePicker, type PersonPick } from '@/components/people/PeoplePicker';
import { pushToast } from '@/components/Toaster';
import type { AuthorMatchView } from '@/lib/zones/reports/authors';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { BTN_PRIMARY, CARD_CLS, SECTION_TITLE_CLS } from '@/app/zones/_components/ui';

export function ReportCoauthors({ reportId, matched, initial, currentUser, onSaved }: { reportId: string; matched: AuthorMatchView[]; initial: PersonPick[]; currentUser: { id: string; handle: string | null }; onSaved?: (next: PersonPick[]) => void }) {
  const t = useTranslations('zones');
  const tt = useTranslations('tools');
  const [value, setValue] = useState<PersonPick[]>(initial);
  const [saving, setSaving] = useState(false);
  const chosen = useMemo(() => new Set(value.map((v) => v.userId)), [value]);
  const quick = matched.filter((m) => m.userId && m.user && m.userId !== currentUser.id);
  const dirty = useMemo(() => value.map((v) => v.userId).join(',') !== initial.map((v) => v.userId).join(','), [value, initial]);

  const toggleQuick = (m: AuthorMatchView) => {
    if (!m.userId || !m.user) return;
    setValue((prev) => {
      if (prev.some((p) => p.userId === m.userId)) return prev.filter((p) => p.userId !== m.userId);
      if (prev.length >= ZONE_LIMITS.maxCoauthors) return prev;
      return [...prev, { userId: m.userId!, user: m.user! }];
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tools/chat-report/${reportId}/coauthors`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds: value.map((v) => v.userId) }) });
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) return pushToast('error', data.reason ?? tt('report_coauthors_failed'));
      pushToast('success', tt('report_coauthors_saved'));
      onSaved?.(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${CARD_CLS} p-5`}>
      <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-2`}>
        <Users className="h-4 w-4 text-muted" />
        {t('report_authors')}
      </h2>
      <p className="mt-1 text-xs text-muted">{tt('report_coauthors_hint')}</p>
      {quick.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {quick.map((m) => {
            const on = chosen.has(m.userId!);
            return (
              <li key={m.account}>
                <button
                  type="button"
                  onClick={() => toggleQuick(m)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm transition ${on ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 hover:border-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-100'}`}
                >
                  <Avatar name={m.user!.displayName} src={m.user!.avatarUrl} size="xs" />
                  <span>{m.user!.displayName}</span>
                  {!on && <DeptTag department={m.user!.department} lab={m.user!.lab} />}
                  <span className={`font-mono text-[11px] ${on ? 'opacity-70' : 'text-muted'}`}>{m.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3">
        <PeoplePicker
          value={value}
          onChange={setValue}
          max={ZONE_LIMITS.maxCoauthors}
          excludeHandles={currentUser.handle ? [currentUser.handle] : []}
          labels={{
            add: t('composer_coauthor_add'),
            search: t('composer_coauthor_search_site'),
            prompt: t('composer_coauthor_prompt'),
            noMatch: t('composer_coauthor_no_match'),
            remove: (name) => t('composer_coauthor_remove', { name }),
          }}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={save} disabled={saving || !dirty} className={BTN_PRIMARY}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {tt('report_coauthors_save')}
        </button>
      </div>
    </section>
  );
}
