'use client';

// 技术专区 post composer — one page, no stepper: type → title → summary →
// cover / link → body (RichTextEditor `full` with the 插入引用 picker) →
// attachments → tags → co-authors, and a footer with 保存草稿 / 发布 (Magnetic).
// The draft autosaves to localStorage `zones:draft:<zoneSlug>:<postId|new>`
// (debounced) and offers 恢复 on the next visit; a successful save clears it.
// Creates through POST /api/zones/<slug>/posts, edits through PATCH
// /api/zones/<slug>/posts/<id> (attachments + co-authors replaced wholesale).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ImagePlus, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { Magnetic } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import {
  MAX_ZONE_IMAGE_BYTES,
  ZONE_IMAGE_TYPES,
  ZONE_LIMITS,
  estimateReadMinutes,
  formatBytes,
  isZonePostVisibility,
  normalizeColumnName,
  normalizeHttpUrl,
  zoneHref,
  zonePostHref,
  type ZonePostTypeValue,
  type ZonePostVisibilityValue,
} from '@/lib/zones/shared';
import type { ZoneAccess, ZoneColumnView, ZoneCurrentUser, ZonePostDetailView } from '@/lib/zones/types';
import {
  AttachmentUploader,
  attachmentPayload,
  draftFromView,
  draftToView,
  uploadErrorKey,
  uploadRaw,
  zoneMediaKeyFromPublicUrl,
  type AttachmentDraft,
} from '@/components/zones/attachments/AttachmentUploader';
import { PostTypePicker } from './PostTypePicker';
import { TagInput } from './TagInput';
import { CoauthorPicker, type CoauthorPick } from './CoauthorPicker';
import { ColumnPicker, type ColumnPick } from './ColumnPicker';
import { VisibilityPicker } from './VisibilityPicker';
import { PostAccessPanel, type DesignatedPick } from './PostAccessPanel';

interface DraftState {
  type: ZonePostTypeValue;
  title: string;
  summary: string;
  bodyMd: string;
  cover: { key: string; url: string } | null;
  linkUrl: string;
  tags: string[];
  coauthors: CoauthorPick[];
  attachments: AttachmentDraft[];
  // v2 (技术专区 v2): 栏目 + 可见范围.
  columnId: string | null;
  columnName: string | null;
  visibility: ZonePostVisibilityValue;
  designated: DesignatedPick[];
}

/** Bumped when DraftState gains fields; `readStored` migrates v1 instead of dropping it. */
const DRAFT_VERSION = 2;

interface StoredDraft {
  v: typeof DRAFT_VERSION;
  savedAt: string;
  draft: DraftState;
}

const AUTOSAVE_MS = 800;
// Stable defaults — a fresh `[]` per render would re-derive `initial` (and re-arm the autosave) on every render.
const EMPTY_COAUTHORS: CoauthorPick[] = [];
const EMPTY_DESIGNATED: DesignatedPick[] = [];
const EMPTY_COLUMNS: ZoneColumnView[] = [];

function draftStorageKey(zoneSlug: string, postId: string | null): string {
  return `zones:draft:${zoneSlug}:${postId ?? 'new'}`;
}

function initialDraft(post: ZonePostDetailView | undefined, coauthors: CoauthorPick[], designated: DesignatedPick[]): DraftState {
  if (!post) {
    return {
      type: 'article',
      title: '',
      summary: '',
      bodyMd: '',
      cover: null,
      linkUrl: '',
      tags: [],
      coauthors: [],
      attachments: [],
      columnId: null,
      columnName: null,
      visibility: 'zone',
      designated: [],
    };
  }
  const coverKey = zoneMediaKeyFromPublicUrl(post.coverUrl);
  return {
    type: post.type,
    title: post.title,
    summary: post.summary,
    bodyMd: post.bodyMd,
    cover: coverKey && post.coverUrl ? { key: coverKey, url: post.coverUrl } : null,
    linkUrl: post.linkUrl ?? '',
    tags: post.tags,
    coauthors,
    attachments: post.attachments.map(draftFromView).filter((a): a is AttachmentDraft => a !== null),
    columnId: post.column?.id ?? null,
    columnName: null,
    visibility: post.visibility,
    designated,
  };
}

function readStored(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; draft?: Partial<DraftState> } | null;
    const d = parsed?.draft;
    if (!d || (parsed?.v !== 1 && parsed?.v !== DRAFT_VERSION)) return null;
    // A v1 draft predates 栏目 / 可见范围: fill the new fields with their defaults
    // (key order stays DraftState's, so the "unchanged" comparison below still works).
    return {
      v: DRAFT_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      draft: {
        ...(d as DraftState),
        columnId: typeof d.columnId === 'string' ? d.columnId : null,
        columnName: typeof d.columnName === 'string' ? d.columnName : null,
        visibility: isZonePostVisibility(d.visibility) ? d.visibility : 'zone',
        designated: Array.isArray(d.designated) ? d.designated : [],
      },
    };
  } catch {
    return null;
  }
}

export function PostComposer({
  zone,
  access,
  currentUser,
  post,
  initialCoauthors = EMPTY_COAUTHORS,
  columns = EMPTY_COLUMNS,
  allowMemberColumns = true,
  initialDesignated = EMPTY_DESIGNATED,
}: {
  zone: { id: string; slug: string; name: string };
  access: ZoneAccess;
  currentUser: ZoneCurrentUser;
  /** Editing an existing post (draft or published). */
  post?: ZonePostDetailView;
  initialCoauthors?: CoauthorPick[];
  /** The zone's 栏目 in display order (official first). */
  columns?: ZoneColumnView[];
  /** `Zone.allowMemberColumns` — 版主 may always create one. */
  allowMemberColumns?: boolean;
  /** Current designated readers of a `restricted` post (the RSC reads the ids). */
  initialDesignated?: DesignatedPick[];
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const initial = useMemo(
    () => initialDraft(post, initialCoauthors, initialDesignated),
    [post, initialCoauthors, initialDesignated],
  );
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const storageKey = draftStorageKey(zone.slug, post?.id ?? null);

  const [draft, setDraft] = useState<DraftState>(initial);
  const [pending, setPending] = useState<StoredDraft | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  // 访问密码 is a live server secret, never draft content: it is never autosaved
  // and never restored — it only ever comes back from the server.
  const [accessCode, setAccessCode] = useState<string | null>(post?.accessCode ?? null);
  const [regenerateCode, setRegenerateCode] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const restoreChecked = useRef(false);

  const patch = useCallback((p: Partial<DraftState>) => setDraft((d) => ({ ...d, ...p })), []);

  // Offer the locally autosaved draft (once, on mount).
  useEffect(() => {
    if (restoreChecked.current) return;
    restoreChecked.current = true;
    const stored = readStored(storageKey);
    if (!stored) return;
    if (JSON.stringify(stored.draft) === initialJson) {
      localStorage.removeItem(storageKey);
      return;
    }
    setPending(stored);
  }, [storageKey, initialJson]);

  // Debounced autosave — only once the draft differs from what the server has.
  useEffect(() => {
    const json = JSON.stringify(draft);
    if (json === initialJson) return;
    const timer = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify({ v: DRAFT_VERSION, savedAt, draft } satisfies StoredDraft));
        setAutosavedAt(savedAt);
      } catch {
        /* quota / private mode — the server draft is the real safety net */
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, initialJson, storageKey]);

  function clearStored() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  const readMinutes = estimateReadMinutes(draft.bodyMd);
  const isPublished = post?.status === 'published';
  const titleLen = [...draft.title.trim()].length;
  // 版主 may always add a 栏目; members only when the zone allows it.
  const canCreateColumn = access.canModerate || allowMemberColumns;

  function validate(): string | null {
    if (draft.columnName && [...normalizeColumnName(draft.columnName)].length > ZONE_LIMITS.columnNameMax) {
      return t('composer_column_too_long', { max: ZONE_LIMITS.columnNameMax });
    }
    if (titleLen < ZONE_LIMITS.postTitleMin) return t('composer_err_title_min', { min: ZONE_LIMITS.postTitleMin });
    if (titleLen > ZONE_LIMITS.postTitleMax) return t('composer_err_title_max', { max: ZONE_LIMITS.postTitleMax });
    if ([...draft.summary].length > ZONE_LIMITS.postSummaryMax) return t('composer_err_summary_max', { max: ZONE_LIMITS.postSummaryMax });
    if (draft.bodyMd.length > ZONE_LIMITS.postBodyMax) return t('composer_err_body_max');
    if (draft.type === 'link' && !normalizeHttpUrl(draft.linkUrl)) return t('composer_err_link_required');
    if (draft.linkUrl.trim() && !normalizeHttpUrl(draft.linkUrl)) return t('composer_err_link_invalid');
    if (draft.type === 'announcement' && !access.canModerate) return t('composer_err_announcement');
    return null;
  }

  async function uploadCover(file: File) {
    if (!ZONE_IMAGE_TYPES.has(file.type)) {
      pushToast('error', t('attach_err_unsupported_type'));
      return;
    }
    if (file.size > MAX_ZONE_IMAGE_BYTES) {
      pushToast('error', t('attach_too_large', { name: file.name, max: formatBytes(MAX_ZONE_IMAGE_BYTES) }));
      return;
    }
    setCoverBusy(true);
    try {
      const r = await uploadRaw(file, `/api/zones/${encodeURIComponent(zone.slug)}/attachments/upload`, { 'x-upload-kind': 'image' });
      patch({ cover: { key: r.key, url: r.url } });
    } catch (e) {
      pushToast('error', t('attach_upload_error', { name: file.name, error: t(uploadErrorKey(e)) }));
    } finally {
      setCoverBusy(false);
    }
  }

  async function submit(status: 'draft' | 'published') {
    if (busy || uploading > 0) return;
    const err = validate();
    if (err) {
      pushToast('error', err);
      return;
    }
    setBusy(status === 'draft' ? 'draft' : 'publish');
    const link = normalizeHttpUrl(draft.linkUrl);
    const restricted = draft.visibility === 'restricted';
    // A 栏目 deleted while the composer was open would make the whole save fail
    // with `column_not_found`; drop the stale id instead (the picker already
    // renders it as 未归栏). Only when we positively know the zone's list.
    const columnId =
      draft.columnName || (columns.length > 0 && !columns.some((c) => c.id === draft.columnId)) ? null : draft.columnId;
    const body = {
      type: draft.type,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      bodyMd: draft.bodyMd,
      coverKey: draft.cover?.key ?? null,
      linkUrl: link,
      tags: draft.tags,
      coauthorIds: draft.coauthors.map((c) => c.userId),
      attachments: attachmentPayload(draft.attachments),
      status,
      // 栏目: a typed name wins server-side, so never send both.
      columnId,
      columnName: draft.columnName ? normalizeColumnName(draft.columnName) : null,
      visibility: draft.visibility,
      designatedUserIds: restricted ? draft.designated.map((d) => d.userId) : [],
      regenerateAccessCode: restricted && regenerateCode,
    };
    try {
      const res = await fetch(
        post ? `/api/zones/${encodeURIComponent(zone.slug)}/posts/${encodeURIComponent(post.id)}` : `/api/zones/${encodeURIComponent(zone.slug)}/posts`,
        { method: post ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      );
      if (res.status === 401) {
        pushToast('error', t('post_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; reason?: string; error?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('composer_save_failed'));
        return;
      }
      const id = post?.id ?? data.id;
      if (!id) {
        pushToast('error', t('composer_save_failed'));
        return;
      }
      clearStored();
      if (status === 'published') {
        pushToast('success', post && isPublished ? t('composer_updated') : t('composer_published'));
        router.push(zonePostHref(zone.slug, id));
        router.refresh();
        return;
      }
      pushToast('success', t('composer_draft_saved'));
      if (!post) {
        // A fresh draft now has an id: continue on its edit page (attachments
        // gain ids there, which the 附件 embed tab needs).
        router.replace(`/zones/${zone.slug}/posts/${id}/edit`);
        router.refresh();
        return;
      }
      // Existing post: pull the saved shape back (attachment ids, cover url,
      // the resolved 栏目 and the freshly issued 访问密码).
      setRegenerateCode(false);
      try {
        const fresh = await fetch(`/api/zones/${encodeURIComponent(zone.slug)}/posts/${encodeURIComponent(id)}`);
        const json = (await fresh.json().catch(() => null)) as { post?: ZonePostDetailView } | null;
        if (fresh.ok && json?.post) {
          const saved = json.post;
          const byKey = new Map<string, AttachmentDraft>();
          for (const a of saved.attachments) {
            const d = draftFromView(a);
            if (d) byKey.set(d.key, d);
          }
          setAccessCode(saved.accessCode ?? null);
          setDraft((d) => ({
            ...d,
            attachments: d.attachments.map((a) => byKey.get(a.key) ?? a),
            // A `columnName` has become a real column — carry its id so the next
            // save does not go through the create path again.
            columnId: saved.column?.id ?? null,
            columnName: null,
            visibility: saved.visibility,
          }));
        }
      } catch {
        /* the next reload shows the ids */
      }
      router.refresh();
    } catch {
      pushToast('error', t('composer_save_failed'));
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const field =
    'w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-500';
  const label = 'mb-1.5 flex items-baseline justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300';
  const savedAttachments = draft.attachments.filter((a) => a.id).map(draftToView);

  return (
    <div className="space-y-6">
      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-muted" />
            {t('composer_restore_prompt', { time: relativeTime(pending.savedAt, locale) })}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(pending.draft);
                setPending(null);
              }}
              className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t('composer_restore')}
            </button>
            <button
              type="button"
              onClick={() => {
                clearStored();
                setPending(null);
              }}
              className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium transition hover:border-zinc-500 dark:border-zinc-700"
            >
              {t('composer_discard')}
            </button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          <Link href={zoneHref(zone.slug)} className="hover:underline">
            {zone.name}
          </Link>
          <span className="mx-1.5">/</span>
          <span>{post ? (isPublished ? t('composer_editing_published') : t('composer_editing_draft')) : t('composer_new')}</span>
        </span>
        <span className="font-mono tabular-nums">
          {t('composer_read_minutes', { count: readMinutes })}
          {autosavedAt && <span className="ml-3">{t('composer_autosaved', { time: relativeTime(autosavedAt, locale) })}</span>}
        </span>
      </div>

      <section>
        <div className={label}>{t('composer_type_label')}</div>
        <PostTypePicker value={draft.type} onChange={(type) => patch({ type })} canAnnounce={access.canModerate} disabled={disabled} />
      </section>

      <section>
        <div className={label}>
          <span>
            {t('composer_column_label')}
            <span className="ml-1 font-normal text-muted">{t('composer_optional')}</span>
          </span>
        </div>
        <ColumnPicker
          columns={columns}
          value={{ columnId: draft.columnId, columnName: draft.columnName }}
          onChange={(pick: ColumnPick) => patch({ columnId: pick.columnId, columnName: pick.columnName })}
          allowCreate={canCreateColumn}
          disabled={disabled}
        />
        <p className="mt-1.5 text-[11px] text-muted">
          {t('composer_column_hint')} {canCreateColumn ? t('composer_column_hint_create') : t('composer_column_hint_locked')}
        </p>
      </section>

      <section>
        <label className={label} htmlFor="zone-post-title">
          <span>{t('composer_title_label')}</span>
          <span className={`font-mono tabular-nums ${titleLen > ZONE_LIMITS.postTitleMax ? 'text-danger' : ''}`}>
            {titleLen}/{ZONE_LIMITS.postTitleMax}
          </span>
        </label>
        <input
          id="zone-post-title"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={t('composer_title_placeholder')}
          maxLength={ZONE_LIMITS.postTitleMax + 20}
          disabled={disabled}
          autoFocus={!post}
          className={`${field} h-12 text-lg font-semibold tracking-tight`}
        />
      </section>

      <section>
        <label className={label} htmlFor="zone-post-summary">
          <span>{t('composer_summary_label')}</span>
          <span className="font-mono tabular-nums">
            {[...draft.summary].length}/{ZONE_LIMITS.postSummaryMax}
          </span>
        </label>
        <textarea
          id="zone-post-summary"
          value={draft.summary}
          onChange={(e) => patch({ summary: e.target.value })}
          placeholder={t('composer_summary_placeholder')}
          rows={2}
          maxLength={ZONE_LIMITS.postSummaryMax + 50}
          disabled={disabled}
          className={`${field} resize-y py-2 leading-relaxed`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className={label}>{t('composer_cover_label')}</div>
          {draft.cover ? (
            <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(draft.cover.url)} alt="" className="aspect-[2/1] w-full object-cover" />
              <button
                type="button"
                onClick={() => patch({ cover: null })}
                disabled={disabled}
                aria-label={t('composer_cover_remove')}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInput.current?.click()}
              disabled={disabled || coverBusy}
              className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-xs text-muted transition hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
            >
              {coverBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              {t('composer_cover_add')}
            </button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept={Array.from(ZONE_IMAGE_TYPES).join(',')}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadCover(f);
              e.target.value = '';
            }}
          />
        </div>
        <div>
          <label className={label} htmlFor="zone-post-link">
            <span>
              {t('composer_link_label')}
              {draft.type !== 'link' && <span className="ml-1 font-normal text-muted">{t('composer_optional')}</span>}
            </span>
          </label>
          <input
            id="zone-post-link"
            value={draft.linkUrl}
            onChange={(e) => patch({ linkUrl: e.target.value })}
            placeholder="https://"
            inputMode="url"
            disabled={disabled}
            className={`${field} h-10 font-mono`}
          />
          <p className="mt-1.5 text-[11px] text-muted">{draft.type === 'link' ? t('composer_link_hint_required') : t('composer_link_hint')}</p>
        </div>
      </section>

      <section>
        <div className={label}>
          <span>{t('composer_body_label')}</span>
          <span className="font-normal text-muted">{t('composer_body_hint')}</span>
        </div>
        <RichTextEditor
          value={draft.bodyMd}
          onChange={(bodyMd) => patch({ bodyMd })}
          variant="full"
          maxLength={ZONE_LIMITS.postBodyMax}
          placeholder={t('composer_body_placeholder')}
          ariaLabel={t('composer_body_label')}
          disabled={disabled}
          embedPicker={{ zoneSlug: zone.slug, attachments: savedAttachments }}
        />
      </section>

      <section>
        <div className={label}>{t('composer_attachments_label')}</div>
        <AttachmentUploader
          zoneSlug={zone.slug}
          value={draft.attachments}
          onChange={(attachments) => patch({ attachments })}
          onUploadingChange={setUploading}
          disabled={disabled}
        />
        {draft.attachments.some((a) => !a.id) && <p className="mt-1.5 text-[11px] text-muted">{t('composer_attachments_embed_hint')}</p>}
      </section>

      <section>
        <div className={label}>{t('composer_tags_label')}</div>
        <TagInput value={draft.tags} onChange={(tags) => patch({ tags })} disabled={disabled} />
      </section>

      <section>
        <div className={label}>{t('composer_coauthors_label')}</div>
        <CoauthorPicker zoneSlug={zone.slug} value={draft.coauthors} onChange={(coauthors) => patch({ coauthors })} selfHandle={currentUser.handle} disabled={disabled} />
      </section>

      <section className="space-y-3">
        <div className={label}>{t('composer_visibility_label')}</div>
        <VisibilityPicker value={draft.visibility} onChange={(visibility) => patch({ visibility })} disabled={disabled} />
        {draft.visibility === 'restricted' && (
          <PostAccessPanel
            zoneSlug={zone.slug}
            postId={post?.id ?? null}
            serverRestricted={post?.visibility === 'restricted'}
            designated={draft.designated}
            onDesignatedChange={(designated) => patch({ designated })}
            accessCode={accessCode}
            onAccessCodeChange={setAccessCode}
            regenerate={regenerateCode}
            onRegenerateChange={setRegenerateCode}
            selfUserId={currentUser.id}
            disabled={disabled}
          />
        )}
      </section>

      <footer className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-[rgb(var(--bg))] px-1 py-3 dark:border-zinc-800">
        <div className="text-xs text-muted">
          {uploading > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('composer_wait_uploads', { count: uploading })}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (JSON.stringify(draft) === initialJson || confirm(t('composer_reset_confirm'))) {
                  setDraft(initial);
                  setRegenerateCode(false);
                  clearStored();
                }
              }}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('composer_reset')}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (post ? router.push(isPublished ? zonePostHref(zone.slug, post.id) : zoneHref(zone.slug)) : router.push(zoneHref(zone.slug)))}
            disabled={disabled}
            className="h-9 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {tc('cancel')}
          </button>
          <button
            type="button"
            onClick={() => submit('draft')}
            disabled={disabled || uploading > 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            {busy === 'draft' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPublished ? t('composer_unpublish') : t('composer_save_draft')}
          </button>
          <Magnetic>
            <button
              type="button"
              onClick={() => submit('published')}
              disabled={disabled || uploading > 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {busy === 'publish' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isPublished ? t('composer_update') : t('composer_publish')}
            </button>
          </Magnetic>
        </div>
      </footer>
    </div>
  );
}
