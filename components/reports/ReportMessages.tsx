'use client';

// 报告「看原文」：按时间排的原始消息——头像 / 姓名 / 时间 / 原话 / 引用 / 链接卡片 / 图片（灯箱）。
// 2026-10-21 起在报告正文里**就地展开**（OriginalMessages，拉 /api/tools/chat-report/[id]/messages）；
// 独立页 /reports/[slug]/messages 保留给直接打开 / 老链接（ReportMessages）。

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronUp, ExternalLink, MessageSquareQuote } from 'lucide-react';
import { isFramed } from '@/lib/framed';
import { holdNavBarHidden } from '@/lib/nav-chrome';
import type { ReportMessageView } from '@/lib/zones/reports/messages';
import { Speaker, Thumbs } from './report-bits';

/** 原始消息列表本体（报告正文里就地展开用；也是独立页的内容）。 */
export function MessageList({ messages, size = 'md' }: { messages: ReportMessageView[]; size?: 'sm' | 'md' }) {
  const t = useTranslations('zones');
  if (messages.length === 0) return <p className="mt-3 text-sm text-muted">{t('report_messages_empty')}</p>;
  const pad = size === 'sm' ? 'px-3 py-2.5' : 'px-4 py-3';
  return (
    <ol className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-900 dark:border-zinc-800 dark:bg-zinc-950">
      {messages.map((m) => (
        <li key={m.id} className={pad}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Speaker name={m.name} account={m.account} user={m.user} size={size === 'sm' ? 'xs' : 'sm'} />
            <span className="ml-auto font-mono text-[11px] text-muted">{m.time}</span>
            <span className="font-mono text-[10px] text-zinc-400">{m.id}</span>
          </div>
          {m.replyTo && (
            <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-xs text-muted dark:border-zinc-800">
              <span className="font-medium">{t('report_messages_reply', { name: m.replyTo.name })}</span>
              <span className="ml-1 line-clamp-3 whitespace-pre-wrap">{m.replyTo.content}</span>
            </blockquote>
          )}
          {m.text && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{m.text}</p>}
          {m.cardTitle && (
            <div className="mt-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
              <div className="font-medium text-zinc-900 dark:text-zinc-50">{m.cardTitle}</div>
              {m.cardDigest && <div className="mt-0.5 line-clamp-3 text-muted">{m.cardDigest}</div>}
            </div>
          )}
          {m.links.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {m.links.map((l, i) => (
                <li key={`${l.url}-${i}`}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-xs text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {l.title || l.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Thumbs items={m.attachments.map((a) => ({ file: a.file, kind: a.kind, url: a.url }))} size="sm" />
        </li>
      ))}
    </ol>
  );
}

/** 独立页 /reports/[slug]/messages（直接打开或老链接）；报告正文里的「看原文」已改为就地展开（OriginalMessages）。 */
export function ReportMessages({ subject, messages, requested }: { subject: string; messages: ReportMessageView[]; requested: number }) {
  const t = useTranslations('zones');
  useEffect(() => {
    if (!isFramed()) return;
    return holdNavBarHidden();
  }, []);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">{subject || t('report_messages_title')}</h1>
        <span className="font-mono text-xs text-muted">{t('report_messages_hint', { found: messages.length, requested })}</span>
      </div>
      <div className="mt-4">
        <MessageList messages={messages} />
      </div>
    </div>
  );
}

/**
 * 报告正文里就地展开的「看原文」（owner 2026-10-21：「不要新建网页，放进当前网页里」）：第一次展开时拉
 * /api/tools/chat-report/[id]/messages?ids=…，结果按 ids 缓存在组件内；再点收起。
 */
const cache = new Map<string, { subject: string; messages: ReportMessageView[]; requested: number }>();

export function OriginalMessages({ reportId, ids, onClose }: { reportId: string; ids: string[]; onClose: () => void }) {
  const t = useTranslations('zones');
  const key = `${reportId}:${ids.join(',')}`;
  const [data, setData] = useState(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cache.has(key)) {
      setData(cache.get(key)!);
      return;
    }
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/tools/chat-report/${encodeURIComponent(reportId)}/messages?ids=${encodeURIComponent(ids.join(','))}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { subject: string; messages: ReportMessageView[]; requested: number };
      })
      .then((d) => {
        cache.set(key, d);
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(t('report_messages_load_failed'));
      });
    return () => {
      cancelled = true;
    };
    // key 已经包含 reportId 和 ids；ids 是调用方每次 render 新建的数组，不能当依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <MessageSquareQuote className="h-3.5 w-3.5" />
          {data ? t('report_messages_hint', { found: data.messages.length, requested: data.requested }) : error ?? t('report_messages_loading')}
        </span>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <ChevronUp className="h-3.5 w-3.5" />
          {t('report_messages_collapse')}
        </button>
      </div>
      {data ? <MessageList messages={data.messages} size="sm" /> : !error && <div className="shimmer h-16 rounded-lg" />}
    </div>
  );
}

