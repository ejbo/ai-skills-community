'use client';

// 报告「看原文」列表：按时间排的原始消息——头像 / 姓名 / 时间 / 原话 / 引用 / 链接卡片 / 图片（灯箱）。
// 被 ReportArticle 以 `page` 目标装进右侧 dock；装在 iframe 里时把全站导航栏藏起来（holdNavBarHidden）。

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { isFramed } from '@/lib/framed';
import { holdNavBarHidden } from '@/lib/nav-chrome';
import type { ReportMessageView } from '@/lib/zones/reports/messages';
import { Speaker, Thumbs } from './report-bits';

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
      {messages.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{t('report_messages_empty')}</p>
      ) : (
        <ol className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {messages.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Speaker name={m.name} account={m.account} user={m.user} size="sm" />
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
      )}
    </div>
  );
}
