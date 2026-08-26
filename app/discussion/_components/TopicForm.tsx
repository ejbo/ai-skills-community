'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import type { DiscussionCategory } from '@prisma/client';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { VISIBLE_CATEGORIES } from './badges';
import { EMPTY_MEDIA, MediaPicker, mediaPayload, type MediaDraft } from './MediaPicker';

const MAX_TOPICS = 3;

/**
 * Shared forum-topic form: creates a topic (POST) or edits an existing one
 * (PATCH). 主题 is a neutral multi-select dropdown (≤3); attachments use the
 * same MediaPicker as the feed composer (video plays inline on the topic
 * page, PDF/PPT/Word download).
 */
export function TopicForm({
  topicId,
  initialTitle = '',
  initialBodyMd = '',
  initialCategories = [],
  initialMedia = EMPTY_MEDIA,
}: {
  topicId?: string;
  initialTitle?: string;
  initialBodyMd?: string;
  initialCategories?: DiscussionCategory[];
  initialMedia?: MediaDraft;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const tl = useTranslations('labels');
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(initialTitle);
  const [categories, setCategories] = useState<DiscussionCategory[]>(
    initialCategories.filter((c) =>
      (VISIBLE_CATEGORIES as readonly DiscussionCategory[]).includes(c),
    ),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bodyMd, setBodyMd] = useState(initialBodyMd);
  const [media, setMedia] = useState<MediaDraft>(initialMedia);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function close(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [pickerOpen]);

  function toggleCategory(key: DiscussionCategory) {
    setCategories((prev) => {
      if (prev.includes(key)) return prev.filter((c) => c !== key);
      if (prev.length >= MAX_TOPICS) {
        pushToast('info', t('max_topics', { max: MAX_TOPICS }));
        return prev;
      }
      return [...prev, key];
    });
  }

  async function submit() {
    if (title.trim().length < 4) {
      pushToast('error', t('title_min'));
      return;
    }
    if (categories.length === 0) {
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

  const selectedLabels = categories
    .map((c) => tl(`discussionCategory.${c}`))
    .join(t('topic_separator'));
  // Editing a legacy topic whose category got retired (e.g. 综合讨论) starts
  // with an empty picker — tell the author why instead of silently blocking.
  const hadRetiredCategory =
    initialCategories.length > 0 &&
    !initialCategories.some((c) => (VISIBLE_CATEGORIES as readonly DiscussionCategory[]).includes(c));

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

      {/* 主题 — neutral multi-select dropdown (no colored chips) */}
      <div ref={pickerRef} className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className={selectedLabels ? '' : 'text-muted'}>
            {selectedLabels || t('select_topics_placeholder', { max: MAX_TOPICS })}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {hadRetiredCategory && categories.length === 0 && (
          <p className="mt-1.5 text-xs text-muted">{t('retired_category_hint')}</p>
        )}
        {pickerOpen && (
          <div className="surface absolute left-0 top-full z-30 mt-2 w-full rounded-xl p-1 shadow-lg">
            {VISIBLE_CATEGORIES.map((key) => {
              const selected = categories.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleCategory(key)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>{tl(`discussionCategory.${key}`)}</span>
                  {selected && <Check className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="full"
        maxLength={20000}
        placeholder={t('topic_body_placeholder')}
        ariaLabel={t('topic_body_aria')}
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
