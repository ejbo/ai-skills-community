'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { VideoUploadField } from '@/components/video/VideoUploadField';
import { RichTextEditor } from '@/components/RichTextEditor';

type Status = 'draft' | 'published';
type Visibility = 'public' | 'unlisted' | 'private';

export interface VideoFormVideo {
  id: string;
  slug: string;
  title: string;
  summary: string;
  descriptionMd: string;
  categorySlug: string | null;
  tags: string[];
  language: string | null;
  intervieweeName: string | null;
  intervieweeTitle: string | null;
  intervieweeOrg: string | null;
  intervieweeBio: string | null;
  transcriptText: string | null;
  status: Status;
  visibility: Visibility;
  featured: boolean;
  videoUrl: string | null;
  videoKey: string | null;
  posterUrl: string | null;
  posterKey: string | null;
  previewUrl: string | null;
  previewKey: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

interface Media {
  url: string;
  key?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

const inputClass =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900';
const textareaClass =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900';
const labelClass = 'text-xs font-medium text-muted';

export function VideoForm({
  categories,
  mode,
  video,
}: {
  categories: { id: string; slug: string; name: string }[];
  mode: 'create' | 'edit';
  video?: VideoFormVideo;
}) {
  const t = useTranslations('video');
  const router = useRouter();

  const [title, setTitle] = useState(video?.title ?? '');
  const [slug, setSlug] = useState(video?.slug ?? '');
  const [summary, setSummary] = useState(video?.summary ?? '');
  const [descriptionMd, setDescriptionMd] = useState(video?.descriptionMd ?? '');
  const [categorySlug, setCategorySlug] = useState(video?.categorySlug ?? '');
  const [tags, setTags] = useState((video?.tags ?? []).join(', '));
  const [language, setLanguage] = useState(video?.language ?? '');
  const [intervieweeName, setIntervieweeName] = useState(video?.intervieweeName ?? '');
  const [intervieweeTitle, setIntervieweeTitle] = useState(video?.intervieweeTitle ?? '');
  const [intervieweeOrg, setIntervieweeOrg] = useState(video?.intervieweeOrg ?? '');
  const [intervieweeBio, setIntervieweeBio] = useState(video?.intervieweeBio ?? '');
  const [transcriptText, setTranscriptText] = useState(video?.transcriptText ?? '');
  const [visibility, setVisibility] = useState<Visibility>(video?.visibility ?? 'public');
  const [featured, setFeatured] = useState(video?.featured ?? false);

  const [source, setSource] = useState<Media | null>(
    video?.videoUrl
      ? {
          url: video.videoUrl,
          key: video.videoKey ?? undefined,
          durationSec: video.durationSec ?? undefined,
          width: video.width ?? undefined,
          height: video.height ?? undefined,
        }
      : null,
  );
  const [poster, setPoster] = useState<Media | null>(
    video?.posterUrl ? { url: video.posterUrl, key: video.posterKey ?? undefined } : null,
  );
  const [previewClip, setPreviewClip] = useState<Media | null>(
    video?.previewUrl ? { url: video.previewUrl, key: video.previewKey ?? undefined } : null,
  );

  const [submitting, setSubmitting] = useState<Status | null>(null);

  function parseTags(): string[] {
    return tags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function submit(status: Status) {
    if (!title.trim()) {
      pushToast('error', t('manage.f_title'));
      return;
    }
    if (!source?.url) {
      pushToast('error', t('manage.upload_video'));
      return;
    }
    setSubmitting(status);

    const payload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      summary: summary.trim() || undefined,
      descriptionMd,
      categorySlug: categorySlug || undefined,
      videoUrl: source.url,
      videoKey: source.key,
      posterUrl: poster?.url,
      posterKey: poster?.key,
      previewUrl: previewClip?.url,
      previewKey: previewClip?.key,
      durationSec: source.durationSec,
      width: source.width,
      height: source.height,
      transcriptText: transcriptText || undefined,
      language: language.trim() || undefined,
      intervieweeName: intervieweeName.trim() || undefined,
      intervieweeTitle: intervieweeTitle.trim() || undefined,
      intervieweeOrg: intervieweeOrg.trim() || undefined,
      intervieweeBio: intervieweeBio.trim() || undefined,
      tags: parseTags(),
      status,
      visibility,
      featured,
    };

    try {
      const res =
        mode === 'create'
          ? await fetch('/api/videos', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/videos/${video!.slug}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        pushToast('error', data?.error ?? 'Save failed');
        return;
      }

      pushToast('success', status === 'published' ? t('manage.publish') : t('manage.save'));
      if (mode === 'create') {
        router.push('/manage/videos');
      } else {
        router.refresh();
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Main column */}
      <div className="space-y-5 lg:col-span-2">
        <section className="surface space-y-4 rounded-xl p-4">
          <Field label={t('manage.f_title')}>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label={t('manage.f_slug')}>
            <input
              className={`${inputClass} font-mono`}
              value={slug}
              placeholder={mode === 'create' ? 'auto' : undefined}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>

          <Field label={t('manage.f_summary')}>
            <input className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>

          <Field label={t('manage.f_description')}>
            <RichTextEditor
              value={descriptionMd}
              onChange={setDescriptionMd}
              maxLength={50000}
              ariaLabel={t('manage.f_description')}
            />
          </Field>
        </section>

        <section className="surface space-y-4 rounded-xl p-4">
          <h3 className="text-sm font-semibold">{t('manage.f_interviewee')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputClass}
                value={intervieweeName}
                onChange={(e) => setIntervieweeName(e.target.value)}
              />
            </Field>
            <Field label="Title">
              <input
                className={inputClass}
                value={intervieweeTitle}
                onChange={(e) => setIntervieweeTitle(e.target.value)}
              />
            </Field>
            <Field label="Org">
              <input
                className={inputClass}
                value={intervieweeOrg}
                onChange={(e) => setIntervieweeOrg(e.target.value)}
              />
            </Field>
            <Field label="Bio">
              <input
                className={inputClass}
                value={intervieweeBio}
                onChange={(e) => setIntervieweeBio(e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="surface space-y-2 rounded-xl p-4">
          <label className={labelClass}>{t('manage.f_transcript')}</label>
          <textarea
            className={textareaClass}
            rows={8}
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
          />
        </section>
      </div>

      {/* Sidebar column */}
      <div className="space-y-5">
        <section className="surface space-y-4 rounded-xl p-4">
          <VideoUploadField
            kind="source"
            label={t('manage.upload_video')}
            value={source}
            onUploaded={(r) =>
              setSource({
                url: r.url,
                key: r.pathname,
                durationSec: r.durationSec,
                width: r.width,
                height: r.height,
              })
            }
          />
          <VideoUploadField
            kind="poster"
            label={t('manage.upload_poster')}
            value={poster}
            onUploaded={(r) => setPoster({ url: r.url, key: r.pathname })}
          />
          <VideoUploadField
            kind="preview"
            label={t('manage.upload_preview')}
            value={previewClip}
            onUploaded={(r) => setPreviewClip({ url: r.url, key: r.pathname })}
          />
        </section>

        <section className="surface space-y-4 rounded-xl p-4">
          <Field label={t('manage.f_category')}>
            <select
              className={inputClass}
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
            >
              <option value="">{t('feed.all_categories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('manage.f_tags')}>
            <input
              className={inputClass}
              value={tags}
              placeholder="a, b, c"
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>

          <Field label={t('manage.f_language')}>
            <input
              className={inputClass}
              value={language}
              placeholder="zh / en"
              onChange={(e) => setLanguage(e.target.value)}
            />
          </Field>

          <Field label={t('manage.f_visibility')}>
            <select
              className={inputClass}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              <option value="public">{t('status.published')}</option>
              <option value="unlisted">{t('status.unlisted')}</option>
              <option value="private">{t('manage.f_visibility')}</option>
            </select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-accent-500 focus:ring-accent-500"
            />
            {t('home.featured')}
          </label>
        </section>

        <section className="surface space-y-2 rounded-xl p-4">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => submit('published')}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {submitting === 'published' && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? t('manage.publish') : t('manage.save')}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => submit('draft')}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            {submitting === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('manage.save_draft')}
          </button>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}
