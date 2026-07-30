'use client';

// 自定义日期范围 (left rail): two native date inputs + 应用. Pushes ?from=&to=
// (clearing preset/day/page) so the RSC page re-renders with the range applied.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

// 起始日期默认今天（含年份），用户只需改动想改的部分。
function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function DateRangePicker() {
  const t = useTranslations('events');
  const router = useRouter();
  const params = useSearchParams();
  const [from, setFrom] = useState(() => params.get('from') ?? todayStr());
  const [to, setTo] = useState(params.get('to') ?? '');

  useEffect(() => {
    setFrom(params.get('from') ?? todayStr());
    setTo(params.get('to') ?? '');
  }, [params]);

  function apply() {
    const sp = new URLSearchParams(params.toString());
    for (const k of ['preset', 'day', 'page']) sp.delete(k);
    if (from) sp.set('from', from);
    else sp.delete('from');
    if (to) sp.set('to', to);
    else sp.delete('to');
    const qs = sp.toString();
    router.push(qs ? `/events?${qs}` : '/events', { scroll: false });
  }

  const inputCls =
    'h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-900';
  return (
    <div className="space-y-1.5">
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className={inputCls}
        aria-label={t('date_from')}
      />
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={inputCls}
        aria-label={t('date_to')}
      />
      <button
        type="button"
        onClick={apply}
        className="h-8 w-full rounded-lg bg-zinc-100 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        {t('apply_range')}
      </button>
    </div>
  );
}
