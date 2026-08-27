'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { DISCUSSION_EMBED_KINDS } from '@/lib/zones/shared';
import type { DiscussionTagOption } from '@/lib/discussion-tags';
import { TopicTagPicker } from './TopicTagPicker';
import { EMPTY_MEDIA, MediaPicker, mediaPayload, type MediaDraft } from './MediaPicker';

/**
 * Shared forum-topic form: creates a topic (POST) or edits an existing one
 * (PATCH). 分类 is the two-tier picker (侧栏分类 must-pick + 自建分类, see
 * TopicTagPicker); the body editor gets the 技术专区 引用 button so a topic can
 * embed 知识库/视频/Skill/活动/专区帖 cards; attachments use the same MediaPicker
 * as the feed composer (video plays inline on the topic page, PDF/PPT/Word
 * download).
 */
export function TopicForm({
  topicId,
  officialTags,
  initialTitle = '',
  initialBodyMd = '',
  initialCategories = [],
  initialTagViews = [],
  initialMedia = EMPTY_MEDIA,
}: {
  topicId?: string;
  /** 侧栏分类，服务端渲染进来（不用再跑一趟 /api/discussion/tags）。 */
  officialTags: DiscussionTagOption[];
  initialTitle?: string;
  initialBodyMd?: string;
  initialCategories?: string[];
  /** 已选分类的完整信息（编辑老帖时自建分类的显示名从这里来）。 */
  initialTagViews?: DiscussionTagOption[];
  initialMedia?: MediaDraft;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(initialTitle);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [bodyMd, setBodyMd] = useState(initialBodyMd);
  const [media, setMedia] = useState<MediaDraft>(initialMedia);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  const officialSlugs = new Set(officialTags.map((tag) => tag.slug));

  async function submit() {
    if (title.trim().length < 4) {
      pushToast('error', t('title_min'));
      return;
    }
    if (!categories.some((slug) => officialSlugs.has(slug))) {
      pushToast('error', t('pick_at_least_one_topic'));
      return;
    }
    if (busy || uploading > 0) return;
    setBusy(true);
    try {
      const res = await fetch(
        topicId ? `/api/discussion/topics/${topicId}` : '/api/discussion/topics',
        {
          method: topicId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            categories,
            bodyMd,
            media: mediaPayload(media),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) {
        pushToast(
          'error',
          data.reason ?? (topicId ? t('save_failed_retry') : t('publish_failed_retry')),
        );
        return;
      }
      pushToast('success', topicId ? tc('saved') : t('published'));
      const id = topicId ?? (data.topic?.id as string);
      router.push(`/discussion/topics/${id}`);
      router.refresh();
    } catch {
      pushToast('error', topicId ? t('save_failed_retry') : t('publish_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  // 编辑一篇分类已退役（例如 综合讨论）的老帖：选择器里是空的，说清楚原因，
  // 别让作者对着一个静默拦住发布的表单发呆。
  const hadRetiredCategory =
    initialCategories.length > 0 && !initialCategories.some((slug) => officialSlugs.has(slug));

  return (
    <div className="surface space-y-4 rounded-2xl p-5">
      <input
        autoFocus={!topicId}
        placeholder={t('topic_title_placeholder')}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />

      <TopicTagPicker
        officialTags={officialTags}
        knownTags={initialTagViews}
        value={categories}
        onChange={setCategories}
        disabled={busy}
      />
      {hadRetiredCategory && <p className="text-xs text-muted">{t('retired_category_hint')}</p>}

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="full"
        maxLength={20000}
        placeholder={t('topic_body_placeholder')}
        ariaLabel={t('topic_body_aria')}
        // 引用站内内容 —— 与技术专区同一套 [embed:kind:ref] 契约。讨论区没有
        // 附件表，所以 `file` 那一 tab 不给（它只认专区帖的附件行）。
        embedPicker={{ kinds: DISCUSSION_EMBED_KINDS }}
      />

      <MediaPicker value={media} onChange={setMedia} onUploadingChange={setUploading} />

      <div className="flex justify-end gap-2">
        <button
          onClick={() => router.back()}
          className="h-9 rounded-lg px-4 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {tc('cancel')}
        </button>
        <button
          onClick={submit}
          disabled={busy || uploading > 0}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {(busy || uploading > 0) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {topicId ? tc('save') : t('publish')}
        </button>
      </div>
    </div>
  );
}
