'use client';

// 发布/编辑活动 — one client form for POST (no eventId) and PATCH (eventId).
// House pattern: plain useState per field, pushToast validation, root-relative
// fetch (basePath shim), RichTextEditor for the markdown description. Speakers
// are an ordered repeater; avatars/cover reuse POST /api/uploads/image (raw
// body + x-filename header) and store the returned ROOT-RELATIVE url.

import { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { CoverEditor } from './CoverEditor';
import { Avatar } from '@/components/Avatar';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import {
  DEFAULT_EVENT_TIMEZONE,
  EVENT_CITIES,
  EVENT_KINDS,
  EVENT_MODES,
  EVENT_TIMEZONES,
  EVENT_TOPICS,
  MAX_EVENT_SPEAKERS,
  MAX_EVENT_TOPICS,
  type EventSpeakerData,
} from '@/lib/events/types';

export interface EventFormInitial {
  title: string;
  summary: string;
  descriptionMd: string;
  kind: string;
  topics: string[];
  mode: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  timezone: string;
  venue: string;
  city: string;
  meetingUrl: string;
  websiteUrl: string;
  coverUrl: string;
  coverPos: string;
  speakers: EventSpeakerData[];
}

interface SpeakerDraft extends EventSpeakerData {
  localId: number;
}

const INPUT_CLS =
  'h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm transition focus:border-accent-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900';

// IANA zone → flat message-key suffix (a zone value can't be a key itself).
const TZ_KEY: Record<string, string> = {
  'America/Toronto': 'toronto',
  'America/Edmonton': 'edmonton',
  'America/Vancouver': 'vancouver',
  'Asia/Shanghai': 'shanghai',
};

function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

async function uploadImage(
  file: File,
  msgs: { notImage: string; failed: string },
): Promise<{ url: string } | null> {
  if (!file.type.startsWith('image/')) {
    pushToast('error', msgs.notImage);
    return null;
  }
  const res = await fetch('/api/uploads/image', {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    pushToast('error', data.reason ?? msgs.failed);
    return null;
  }
  return data as { url: string };
}

export function EventForm({ eventId, initial }: { eventId?: string; initial?: EventFormInitial }) {
  const t = useTranslations('event_form');
  const tc = useTranslations('common');
  const tl = useTranslations('labels');
  const router = useRouter();
  const pathname = usePathname();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [descriptionMd, setDescriptionMd] = useState(initial?.descriptionMd ?? '');
  const [kind, setKind] = useState(initial?.kind ?? '');
  const [topics, setTopics] = useState<string[]>(initial?.topics ?? []);
  const [mode, setMode] = useState(initial?.mode ?? 'offline');
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayLocal());
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone || DEFAULT_EVENT_TIMEZONE);
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [meetingUrl, setMeetingUrl] = useState(initial?.meetingUrl ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? '');
  const [coverPos, setCoverPos] = useState(initial?.coverPos ?? '');
  const [withSpeakers, setWithSpeakers] = useState((initial?.speakers?.length ?? 0) > 0);
  const speakerSeq = useRef(0);
  const [speakers, setSpeakers] = useState<SpeakerDraft[]>(
    (initial?.speakers ?? []).map((s) => ({ ...s, localId: speakerSeq.current++ })),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);

  function toggleTopic(slug: string) {
    setTopics((cur) => {
      if (cur.includes(slug)) return cur.filter((s) => s !== slug);
      if (cur.length >= MAX_EVENT_TOPICS) {
        pushToast('info', t('max_topics', { max: MAX_EVENT_TOPICS }));
        return cur;
      }
      return [...cur, slug];
    });
  }

  function addSpeaker() {
    setSpeakers((cur) =>
      cur.length >= MAX_EVENT_SPEAKERS
        ? cur
        : [...cur, { localId: speakerSeq.current++, name: '', title: '', org: '', avatarUrl: '', link: '', bio: '' }],
    );
  }

  function patchSpeaker(localId: number, patch: Partial<EventSpeakerData>) {
    setSpeakers((cur) => cur.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function moveSpeaker(localId: number, dir: -1 | 1) {
    setSpeakers((cur) => {
      const i = cur.findIndex((s) => s.localId === localId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function pickImage(onDone: (url: string) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading((n) => n + 1);
      try {
        const up = await uploadImage(file, {
          notImage: t('pick_image_file'),
          failed: t('image_upload_failed'),
        });
        if (up) onDone(up.url);
      } finally {
        setUploading((n) => n - 1);
      }
    };
    input.click();
  }

  async function submit() {
    if (title.trim().length < 4) return pushToast('error', t('err_title_too_short'));
    if (!kind) return pushToast('error', t('err_pick_kind'));
    if (!startDate) return pushToast('error', t('err_pick_start_date'));
    if (!allDay && !startTime) return pushToast('error', t('err_need_start_time'));
    const effectiveSpeakers = withSpeakers
      ? speakers.filter((s) => s.name.trim() || s.title || s.org || s.bio || s.avatarUrl || s.link)
      : [];
    if (effectiveSpeakers.some((s) => !s.name.trim())) {
      return pushToast('error', t('err_speaker_name_required'));
    }
    if (busy || uploading > 0) return;
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        summary: summary.trim(),
        descriptionMd,
        kind,
        topics,
        mode,
        startDate,
        startTime: allDay ? '' : startTime,
        endDate,
        endTime: allDay ? '' : endTime,
        allDay,
        // 始终发合法枚举值；全天活动由服务端置空。
        timezone,
        venue: mode === 'online' ? '' : venue.trim(),
        city: mode === 'online' ? '' : city.trim(),
        meetingUrl: mode === 'offline' ? '' : meetingUrl.trim(),
        websiteUrl: websiteUrl.trim(),
        coverUrl,
        coverPos,
        speakers: effectiveSpeakers.map(({ localId: _drop, ...s }) => ({ ...s, name: s.name.trim() })),
      };
      const res = await fetch(eventId ? `/api/events/${eventId}` : '/api/events', {
        method: eventId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', t('err_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) {
        pushToast('error', data.reason ?? (eventId ? t('err_save_failed') : t('err_publish_failed')));
        return;
      }
      pushToast('success', eventId ? tc('saved') : t('published'));
      const id = eventId ?? (data.event?.id as string);
      router.push(`/events/${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const showTimeFields = !allDay;
  return (
    <div className="space-y-7">
      {/* 标题 + 简介 */}
      <Field label={t('f_title')} required>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          placeholder={t('title_placeholder')}
          className={INPUT_CLS}
        />
      </Field>
      <Field label={t('f_summary')} hint={t('summary_hint')}>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={300}
          placeholder={t('summary_placeholder')}
          className={INPUT_CLS}
        />
      </Field>

      {/* 大类 */}
      <Field label={t('f_kind')} required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EVENT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={`rounded-xl border p-3 text-left transition ${
                kind === k.value
                  ? 'border-accent-500 bg-accent-500/5 ring-1 ring-accent-500'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
              }`}
            >
              <div className="text-sm font-medium">{tl(`eventKind.${k.value}`)}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{t(`kind_desc_${k.value}`)}</div>
            </button>
          ))}
        </div>
      </Field>

      {/* 主题 */}
      <Field label={t('f_topics')} hint={t('topics_hint', { max: MAX_EVENT_TOPICS })}>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_TOPICS.map((tp) => (
            <button
              key={tp.slug}
              type="button"
              onClick={() => toggleTopic(tp.slug)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                topics.includes(tp.slug)
                  ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-400'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300'
              }`}
            >
              {t(`topic_${tp.slug}`)}
            </button>
          ))}
        </div>
      </Field>

      {/* 时间 */}
      <Field label={t('f_time')} required>
        <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-accent-500 focus:ring-accent-500"
          />
          {t('all_day_label')}
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={showTimeFields ? '' : 'col-span-1 sm:col-span-2'}>
            <span className="mb-1 block text-xs text-muted">{t('start_date')}</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT_CLS} />
          </div>
          {showTimeFields && (
            <div>
              <span className="mb-1 block text-xs text-muted">{t('start_time')}</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT_CLS} />
            </div>
          )}
          <div className={showTimeFields ? '' : 'col-span-1 sm:col-span-2'}>
            <span className="mb-1 block text-xs text-muted">{t('end_date')}</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={INPUT_CLS} />
          </div>
          {showTimeFields && (
            <div>
              <span className="mb-1 block text-xs text-muted">{t('end_time')}</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT_CLS} />
            </div>
          )}
        </div>
        {showTimeFields && (
          <div className="mt-2">
            <span className="mb-1 block text-xs text-muted">{t('timezone_hint')}</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={`${INPUT_CLS} sm:max-w-xs`}
            >
              {EVENT_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {t(`tz_${TZ_KEY[tz.value]}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </Field>

      {/* 形式 + 地点 */}
      <Field label={t('f_mode')} required>
        <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          {EVENT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={
                mode === m.value
                  ? 'rounded-md bg-accent-500 px-4 py-1.5 text-xs font-medium text-white'
                  : 'rounded-md px-4 py-1.5 text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100'
              }
            >
              {tl(`eventMode.${m.value}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {mode !== 'offline' && (
            <input
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              maxLength={500}
              placeholder={t('meeting_url_placeholder')}
              className={INPUT_CLS}
            />
          )}
          {mode !== 'online' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                maxLength={200}
                placeholder={t('venue_placeholder')}
                className={INPUT_CLS}
              />
              <select value={city} onChange={(e) => setCity(e.target.value)} className={INPUT_CLS}>
                <option value="">{t('city_placeholder')}</option>
                {EVENT_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`city_${c.toLowerCase()}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            maxLength={500}
            placeholder={t('website_placeholder')}
            className={INPUT_CLS}
          />
        </div>
      </Field>

      {/* 封面 */}
      <Field label={t('f_cover')} hint={t('cover_hint')}>
        {coverUrl ? (
          <CoverEditor
            coverUrl={coverUrl}
            pos={coverPos}
            onPosChange={setCoverPos}
            onRemove={() => {
              setCoverUrl('');
              setCoverPos('');
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() =>
              pickImage((url) => {
                setCoverUrl(url);
                setCoverPos(''); // 新图默认完整显示，裁切重新选
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-4 text-sm text-muted transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
          >
            <ImagePlus className="h-4 w-4" />
            {t('upload_cover')}
          </button>
        )}
      </Field>

      {/* 介绍 */}
      <Field label={t('f_description')} hint={t('description_hint')}>
        <RichTextEditor
          value={descriptionMd}
          onChange={setDescriptionMd}
          variant="full"
          maxLength={20000}
          placeholder={t('description_placeholder')}
          ariaLabel={t('f_description')}
        />
      </Field>

      {/* 讲师 / 嘉宾 */}
      <div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={withSpeakers}
            onChange={(e) => {
              setWithSpeakers(e.target.checked);
              if (e.target.checked && speakers.length === 0) addSpeaker();
            }}
            className="h-4 w-4 rounded border-zinc-300 text-accent-500 focus:ring-accent-500"
          />
          {t('with_speakers')}
        </label>
        {withSpeakers && (
          <div className="mt-3 space-y-3">
            {speakers.map((s, i) => (
              <div key={s.localId} className="surface rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => pickImage((url) => patchSpeaker(s.localId, { avatarUrl: url }))}
                    title={t('upload_avatar')}
                    className="group relative shrink-0 rounded-full"
                  >
                    <Avatar name={s.name || t('speaker_n', { n: i + 1 })} src={s.avatarUrl || null} size="lg" />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100">
                      <Upload className="h-4 w-4 text-white" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        value={s.name}
                        onChange={(e) => patchSpeaker(s.localId, { name: e.target.value })}
                        maxLength={80}
                        placeholder={t('speaker_name_placeholder')}
                        className={INPUT_CLS}
                      />
                      <input
                        value={s.title}
                        onChange={(e) => patchSpeaker(s.localId, { title: e.target.value })}
                        maxLength={120}
                        placeholder={t('speaker_title_placeholder')}
                        className={INPUT_CLS}
                      />
                      <input
                        value={s.org}
                        onChange={(e) => patchSpeaker(s.localId, { org: e.target.value })}
                        maxLength={120}
                        placeholder={t('speaker_org_placeholder')}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                      <input
                        value={s.link}
                        onChange={(e) => patchSpeaker(s.localId, { link: e.target.value })}
                        maxLength={500}
                        placeholder={t('speaker_link_placeholder')}
                        className={`${INPUT_CLS} pl-9`}
                      />
                    </div>
                    <textarea
                      value={s.bio}
                      onChange={(e) => patchSpeaker(s.localId, { bio: e.target.value })}
                      maxLength={2000}
                      rows={2}
                      placeholder={t('speaker_bio_placeholder')}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition focus:border-accent-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveSpeaker(s.localId, -1)}
                      disabled={i === 0}
                      aria-label={t('move_up')}
                      className="rounded-lg p-1.5 text-muted transition hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSpeaker(s.localId, 1)}
                      disabled={i === speakers.length - 1}
                      aria-label={t('move_down')}
                      className="rounded-lg p-1.5 text-muted transition hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeakers((cur) => cur.filter((x) => x.localId !== s.localId))}
                      aria-label={t('delete_speaker')}
                      className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {speakers.length < MAX_EVENT_SPEAKERS && (
              <button
                type="button"
                onClick={addSpeaker}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-4 text-sm text-muted transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
              >
                <Plus className="h-4 w-4" />
                {t('add_speaker')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* submit */}
      <div className="flex items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <button
          type="button"
          onClick={submit}
          disabled={busy || uploading > 0}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent-500 px-6 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {(busy || uploading > 0) && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading > 0 ? t('uploading_image') : eventId ? t('save_changes') : t('publish_event')}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {tc('cancel')}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-medium">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
