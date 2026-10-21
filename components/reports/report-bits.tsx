'use client';

// 报告原生视图的小部件（ReportArticle / ReportMessages 共用，docs/contracts/reports.md §3a）：
//   RichText   模型文案里的 **粗体** → 高亮关键词（浅黄底 + 加粗，内容色不是 chrome 色），`code` → code
//   Speaker    头像（工号匹配到站内用户就带悬停名片）+ 姓名 + 账号
//   SourceChips 来源 → 右侧 dock（外链 = link 卡片，预置数据不发请求；知识库文档 = library）
//   Thumbs     图片缩略图 → BodyImageLightbox 放大；文件 → dock 的 file 卡片 / 新窗口
//   roleLabel / tagLabel / confLabel  枚举显示文案走 i18n（存的值永不翻译）

import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText, ImageOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import { withBasePath } from '@/lib/base-path';
import type { PublicAuthor } from '@/lib/user-identity';
import { embedKey, hostnameOf } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { BodyImageLightbox, type BodyImage } from '@/app/zones/_components/post/BodyImageLightbox';

/** `**粗体**` → 高亮；`` `code` `` → code。其余纯文本。 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(
        <mark key={i++} className="rounded-sm bg-amber-100/80 px-0.5 font-semibold text-zinc-900 dark:bg-amber-400/20 dark:text-zinc-50">
          {m[1]}
        </mark>,
      );
    } else {
      parts.push(
        <code key={i++} className="rounded bg-zinc-100 px-1 font-mono text-[0.9em] dark:bg-zinc-800">
          {m[2]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}

const ROLE_KEY: Record<string, string> = { 提出: 'propose', 回应: 'respond', 质疑: 'challenge', 补充: 'add', 判断: 'judge', 进展: 'progress', 结论: 'conclude', 通知: 'notice' };
const TAG_KEY: Record<string, string> = { 共识: 'consensus', 分歧: 'divergence', 判断: 'judgment', 格局: 'landscape', 杠杆: 'leverage', 风险: 'risk', 进展: 'progress' };
const CONF_KEY: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };

/** 角色的语义色：提出 / 补充 = 墨色，质疑 = 琥珀，判断 / 结论 = 绿，进展 = 天蓝，通知 / 回应 = 灰。内容色，不是 chrome。 */
const ROLE_CLS: Record<string, string> = {
  提出: 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100',
  补充: 'border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-300',
  回应: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  质疑: 'border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-300',
  判断: 'border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300',
  结论: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-zinc-900',
  进展: 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300',
  通知: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
};

export function useReportLabels() {
  const t = useTranslations('zones');
  return {
    role: (v?: string | null) => (v && ROLE_KEY[v] ? t(`report_role_${ROLE_KEY[v]}`) : (v ?? '')),
    tag: (v: string) => (TAG_KEY[v] ? t(`report_tag_${TAG_KEY[v]}`) : v),
    conf: (v: string) => (CONF_KEY[v] ? t(`report_conf_${CONF_KEY[v]}`) : v),
  };
}

export function RoleChip({ role }: { role?: string | null }) {
  const labels = useReportLabels();
  if (!role) return null;
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[11px] font-semibold leading-4 ${ROLE_CLS[role] ?? ROLE_CLS.回应}`}>{labels.role(role)}</span>;
}

/** 发言人：匹配到站内用户 → 真头像 + 悬停名片；否则按姓名生成的身份色头像。 */
export function Speaker({ name, account, user, size = 'sm', showAccount = true, showName = true }: { name: string; account?: string | null; user?: PublicAuthor | null; size?: 'xs' | 'sm' | 'md'; showAccount?: boolean; showName?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={user?.displayName || name} src={user?.avatarUrl ?? null} size={size} handle={user?.handle ?? null} />
      {showName && <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{user?.displayName || name}</span>}
      {showName && showAccount && account ? <span className="shrink-0 font-mono text-[11px] text-muted">{account}</span> : null}
    </span>
  );
}

export interface SourceRef {
  label: string;
  url?: string;
  /** 由谁在何时分享（link 卡片的描述）。 */
  who?: string;
  when?: string;
}

function linkPreset(s: SourceRef, description: string): EmbedData {
  const url = s.url!;
  return { kind: 'link', ref: url, ok: true, data: { url, hostname: hostnameOf(url), title: s.label, description, imageUrl: null, siteName: '' } };
}

/** 来源 chips：有 url 的点开右侧 dock（link 卡片 + 打开链接按钮），没有 url 的只是文字（如「群内观点」）。 */
export function SourceChips({ sources, label, librarySlug, embeds }: { sources: SourceRef[]; label?: string; librarySlug?: string | null; embeds?: Record<string, EmbedData> }) {
  const preview = usePreview();
  const t = useTranslations('zones');
  if (!sources.length && !librarySlug) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{label ?? t('report_sources')}</span>
      {librarySlug && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-900 px-1.5 py-0.5 font-medium text-zinc-900 transition hover:bg-zinc-900 hover:text-white dark:border-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
          onClick={() => preview.open({ kind: 'library', ref: librarySlug, data: embeds?.[embedKey('library', librarySlug)], via: 'pointer' })}
        >
          <FileText className="h-3 w-3" />
          {t('report_library_docs')}
        </button>
      )}
      {sources.map((s, i) =>
        s.url ? (
          <button
            key={`${s.url}-${i}`}
            type="button"
            title={s.url}
            className="inline-flex max-w-[18rem] items-center gap-1 truncate rounded-md border border-zinc-300 px-1.5 py-0.5 font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
            onClick={() => preview.open({ kind: 'link', ref: s.url!, title: s.label, data: linkPreset(s, [s.who, s.when].filter(Boolean).join(' · ')), via: 'pointer' })}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{s.label}</span>
          </button>
        ) : (
          <span key={`${s.label}-${i}`} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {s.label}
          </span>
        ),
      )}
    </div>
  );
}

export interface ThumbItem {
  file: string;
  kind: 'image' | 'file';
  /** 根相对 URL（这里过 withBasePath）；null = 没上传。 */
  url: string | null;
  caption?: string;
}

/** 图片缩略图（点开灯箱）+ 文件卡片（新窗口打开）。灯箱是每个列表自己的（受控）。 */
export function Thumbs({ items, size = 'md' }: { items: ThumbItem[]; size?: 'sm' | 'md' }) {
  const t = useTranslations('zones');
  const [lightbox, setLightbox] = useState<BodyImage | null>(null);
  const close = useCallback(() => setLightbox(null), []);
  if (!items.length) return null;
  const box = size === 'sm' ? 'h-20 w-28' : 'h-28 w-40';
  const onImg = (e: MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setLightbox({ src: img.currentSrc || img.src, alt: img.alt, rect: img.getBoundingClientRect() });
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a, i) =>
        a.kind === 'image' && a.url ? (
          <figure key={`${a.file}-${i}`} className={`${box} m-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath(a.url)} alt={a.caption || a.file} loading="lazy" className="h-full w-full cursor-zoom-in object-cover" onClick={onImg} />
          </figure>
        ) : a.url ? (
          <a
            key={`${a.file}-${i}`}
            href={withBasePath(a.url)}
            target="_blank"
            rel="noopener"
            className={`${box} flex flex-col items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-center text-[11px] text-zinc-600 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400`}
          >
            <FileText className="h-5 w-5" />
            <span className="line-clamp-2 break-all">{a.file}</span>
          </a>
        ) : (
          <div key={`${a.file}-${i}`} className={`${box} flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 px-2 text-center text-[11px] text-muted dark:border-zinc-700`} title={t('report_missing_file', { file: a.file })}>
            <ImageOff className="h-5 w-5" />
            <span className="line-clamp-2 break-all">{a.file}</span>
          </div>
        ),
      )}
      <BodyImageLightbox image={lightbox} onClose={close} />
    </div>
  );
}

