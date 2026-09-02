'use client';

// 技术专区 post composer — DOCUMENT-FIRST: a top bar (ComposerTopBar) that
// replaces the navbar, then a 720 px document column — 「发布到 ▾ 栏目」 →
// a big borderless title → a one-line summary → the body (RichTextEditor
// `chrome="document" size="article"`, the reader's own typography) → a
// collapsible 附件 ledger — with the non-text settings (封面 / 链接 / 标签 /
// 合著者 / 可见范围) in ComposerSettingsSheet (sticky column on xl, a drawer
// below). There is no 类型 control any more: the schema defaults `type` to
// `article` and 公告 is a moderator flag on the reading page.
//
// Files: dropping / pasting / 📎 in the body uploads AT THE CARET as
// `[embed:file:<key>]` and the finished draft is appended to `attachments`
// here (the ledger). The ledger's 在正文插入 inserts a card for an unreferenced
// row through `editorRef`; removing a row that is in the body strips its
// own-line token too. On save the server unions body keys with the ledger
// (mergeBodyFileKeys), so nothing can be orphaned either way.
//
// The draft autosaves to localStorage `zones:draft:<zoneSlug>:<postId|new>`
// (debounced) and offers 恢复 on the next visit; a successful save clears it.
// Creates through POST /api/zones/<slug>/posts, edits through PATCH
// /api/zones/<slug>/posts/<id> (attachments + co-authors replaced wholesale).

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/react';
import { ChevronRight, Paperclip, RotateCcw } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import {
  MAX_ZONE_IMAGE_BYTES,
  ZONE_IMAGE_TYPES,
  ZONE_LIMITS,
  collectEmbedRefs,
  estimateReadMinutes,
  formatBytes,
  isZonePostVisibility,
  normalizeColumnName,
  normalizeHttpUrl,
  parseEmbedToken,
  zoneHref,
  zonePostHref,
  type ZonePostVisibilityValue,
} from '@/lib/zones/shared';
import { ARTICLE_MEASURE_CLASS } from '@/lib/zones/prose';
import type { ZoneAccess, ZoneColumnView, ZoneCurrentUser, ZonePostDetailView } from '@/lib/zones/types';
import { currentLoginHref } from '@/lib/auth/callback-path';
import {
  AttachmentUploader,
  attachmentPayload,
  draftFromView,
  draftToView,
  uploadEndpoint,
  uploadErrorKey,
  uploadRaw,
  zoneMediaKeyFromPublicUrl,
  type AttachmentDraft,
} from '@/components/zones/attachments/AttachmentUploader';
import { insertContentEmbed } from '@/components/zones/embeds/embed-node-extension';
import { attachmentPreviewRef } from '@/components/zones/attachments/AttachmentCard';
import { ComposerTopBar } from './ComposerTopBar';
import { ComposerSettingsSheet } from './ComposerSettingsSheet';
import type { CoauthorPick } from './CoauthorPicker';
import { ColumnPicker, type ColumnPick } from './ColumnPicker';
import type { DesignatedPick } from './PostAccessPanel';

interface DraftState {
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

/**
 * Bumped when DraftState changes shape; `readStored` migrates older versions
 * instead of dropping them. v3 (2026-09): `type` is gone from the draft.
 * Append-only rule: new fields go at the END of `initialDraft`'s literals AND
 * of the migration spread, or the JSON "unchanged" comparison breaks.
 */
const DRAFT_VERSION = 3;
const READABLE_VERSIONS: ReadonlySet<unknown> = new Set([1, 2, 3]);

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
const TITLE_COUNTER_FROM = 100;
const SUMMARY_COUNTER_FROM = 260;

function draftStorageKey(zoneSlug: string, postId: string | null): string {
  return `zones:draft:${zoneSlug}:${postId ?? 'new'}`;
}

function initialDraft(post: ZonePostDetailView | undefined, coauthors: CoauthorPick[], designated: DesignatedPick[]): DraftState {
  if (!post) {
    return {
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
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; draft?: Partial<DraftState> & { type?: unknown } } | null;
    const d = parsed?.draft;
    if (!d || !READABLE_VERSIONS.has(parsed?.v)) return null;
    // v1/v2 drafts carried `type`: destructure it OUT before re-spreading, or
    // the extra key would make an otherwise identical draft compare unequal to
    // `initialJson` (the "unchanged → clear" rule) and re-offer 恢复 forever.
    // A v1 draft predates 栏目 / 可见范围: fill those with their defaults (key
    // order stays DraftState's).
    const { type: _type, ...rest } = d;
    void _type;
    return {
      v: DRAFT_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      draft: {
        ...(rest as DraftState),
        columnId: typeof rest.columnId === 'string' ? rest.columnId : null,
        columnName: typeof rest.columnName === 'string' ? rest.columnName : null,
        visibility: isZonePostVisibility(rest.visibility) ? rest.visibility : 'zone',
        designated: Array.isArray(rest.designated) ? rest.designated : [],
      },
    };
  } catch {
    return null;
  }
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Drops the own-line `[embed:file:<ref>]` tokens for `refs` (fence-aware) — the ledger row left, so its card goes too. */
export function stripFileEmbedTokens(md: string, refs: readonly string[]): string {
  if (!md.includes('[embed:') || refs.length === 0) return md;
  const drop = new Set(refs);
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const mark = FENCE_RE.exec(line);
    if (mark) {
      const char = mark[1][0];
      const len = mark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      out.push(line);
      continue;
    }
    if (!fence) {
      const parsed = parseEmbedToken(line);
      if (parsed && parsed.kind === 'file' && drop.has(parsed.ref)) continue;
    }
    out.push(line);
  }
  return out.join('\n');
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
  const locale = useLocale();
  const router = useRouter();
  const initial = useMemo(
    () => initialDraft(post, initialCoauthors, initialDesignated),
    [post, initialCoauthors, initialDesignated],
  );
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const storageKey = draftStorageKey(zone.slug, post?.id ?? null);

  const [draft, setDraft] = useState<DraftState>(initial);
  const [pending, setPending] = useState<StoredDraft | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(0);
  const [editorUploading, setEditorUploading] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 访问密码 is a live server secret, never draft content: it is never autosaved
  // and never restored — it only ever comes back from the server.
  const [accessCode, setAccessCode] = useState<string | null>(post?.accessCode ?? null);
  const [regenerateCode, setRegenerateCode] = useState(false);
  const restoreChecked = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLInputElement>(null);

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

  // Title auto-grow: `field-sizing: content` where supported, scrollHeight elsewhere.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.title]);

  function clearStored() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  const uploading = attachmentUploading + editorUploading;
  const readMinutes = estimateReadMinutes(draft.bodyMd);
  const charCount = [...draft.bodyMd].length;
  const isPublished = post?.status === 'published';
  const titleLen = [...draft.title.trim()].length;
  const summaryLen = [...draft.summary].length;
  // 版主 may always add a 栏目; members only when the zone allows it.
  const canCreateColumn = access.canModerate || allowMemberColumns;
  const settingsIncomplete = draft.visibility === 'restricted' && draft.designated.length === 0;

  // Ids / keys the body references — the ledger shows 「正文中」 on those rows.
  const insertedRefs = useMemo(
    () => new Set(collectEmbedRefs(draft.bodyMd).filter((r) => r.kind === 'file').map((r) => r.ref)),
    [draft.bodyMd],
  );
  const savedAttachments = useMemo(() => draft.attachments.filter((a) => a.id).map(draftToView), [draft.attachments]);

  function validate(): string | null {
    if (draft.columnName && [...normalizeColumnName(draft.columnName)].length > ZONE_LIMITS.columnNameMax) {
      return t('composer_column_too_long', { max: ZONE_LIMITS.columnNameMax });
    }
    if (titleLen < ZONE_LIMITS.postTitleMin) return t('composer_err_title_min', { min: ZONE_LIMITS.postTitleMin });
    if (titleLen > ZONE_LIMITS.postTitleMax) return t('composer_err_title_max', { max: ZONE_LIMITS.postTitleMax });
    if (summaryLen > ZONE_LIMITS.postSummaryMax) return t('composer_err_summary_max', { max: ZONE_LIMITS.postSummaryMax });
    if (draft.bodyMd.length > ZONE_LIMITS.postBodyMax) return t('composer_err_body_max');
    if (draft.linkUrl.trim() && !normalizeHttpUrl(draft.linkUrl)) return t('composer_err_link_invalid');
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
      const r = await uploadRaw(file, uploadEndpoint(zone.slug), { 'x-upload-kind': 'image' });
      patch({ cover: { key: r.key, url: r.url } });
    } catch (e) {
      pushToast('error', t('attach_upload_error', { name: file.name, error: t(uploadErrorKey(e)) }));
    } finally {
      setCoverBusy(false);
    }
  }

  /** Resolves true on success (the StatefulButton draws its ✓); false after a toast. */
  async function submit(status: 'draft' | 'published'): Promise<boolean> {
    if (busy || uploading > 0) return false;
    const err = validate();
    if (err) {
      pushToast('error', err);
      return false;
    }
    setBusy(status === 'draft' ? 'draft' : 'publish');
    const link = normalizeHttpUrl(draft.linkUrl);
    const restricted = draft.visibility === 'restricted';
    // A 栏目 deleted while the composer was open would make the whole save fail
    // with `column_not_found`; drop the stale id instead (the picker already
    // renders it as 未归栏). Only when we positively know the zone's list.
    const columnId =
      draft.columnName || (columns.length > 0 && !columns.some((c) => c.id === draft.columnId)) ? null : draft.columnId;
    // No `type`: the schema defaults it to `article` (公告 is set from the reading page).
    const body = {
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
        router.push(currentLoginHref());
        return false;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; reason?: string; error?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('composer_save_failed'));
        return false;
      }
      const id = post?.id ?? data.id;
      if (!id) {
        pushToast('error', t('composer_save_failed'));
        return false;
      }
      clearStored();
      if (status === 'published') {
        pushToast('success', post && isPublished ? t('composer_updated') : t('composer_published'));
        router.push(zonePostHref(zone.slug, id));
        router.refresh();
        return true;
      }
      pushToast('success', t('composer_draft_saved'));
      if (!post) {
        // A fresh draft now has an id: continue on its edit page (attachments
        // gain ids there).
        router.replace(`/zones/${zone.slug}/posts/${id}/edit`);
        router.refresh();
        return true;
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
      return true;
    } catch {
      pushToast('error', t('composer_save_failed'));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (JSON.stringify(draft) === initialJson || confirm(t('composer_reset_confirm'))) {
      setDraft(initial);
      setRegenerateCode(false);
      clearStored();
    }
  }

  // 在正文插入 (ledger row → card at the caret block). Saved rows by id, drafts by key.
  function insertFromLedger(d: AttachmentDraft) {
    const ed = editorRef.current;
    if (!ed) return;
    const ref = d.id ?? attachmentPreviewRef(draftToView(d));
    if (ref) insertContentEmbed(ed, 'file', ref);
  }

  // A removed ledger row takes its body card with it (both ref forms).
  function onLedgerRemove(_index: number, gone: AttachmentDraft) {
    const refs = [gone.key, ...(gone.id ? [gone.id] : [])];
    setDraft((d) => (insertedRefs.size === 0 ? d : { ...d, bodyMd: stripFileEmbedTokens(d.bodyMd, refs) }));
  }

  const onTitleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // A title is one line: Enter moves on to the summary.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      summaryRef.current?.focus();
    }
  };

  const disabled = busy !== null;
  const backHref = post ? (isPublished ? zonePostHref(zone.slug, post.id) : zoneHref(zone.slug)) : zoneHref(zone.slug);
  const saveLabel = isPublished ? t('composer_unpublish') : t('composer_save_draft');
  const publishLabel = isPublished ? t('composer_update') : t('composer_publish');

  return (
    <div>
      <ComposerTopBar
        backHref={backHref}
        zoneName={zone.name}
        published={Boolean(isPublished)}
        autosavedAt={autosavedAt}
        uploading={uploading}
        settingsIncomplete={settingsIncomplete}
        onOpenSettings={() => setSettingsOpen(true)}
        saveLabel={saveLabel}
        publishLabel={publishLabel}
        onSaveDraft={() => submit('draft')}
        onPublish={() => submit('published')}
        disabled={disabled}
      />

      <div className="py-8 xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-8">
        <div className={`mx-auto w-full ${ARTICLE_MEASURE_CLASS}`}>
          {pending && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <span className="inline-flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-muted" />
                {/* suppressHydrationWarning must sit on the TEXT-ONLY node — it does
                    not cover text children that sit beside the icon above. */}
                <span suppressHydrationWarning>{t('composer_restore_prompt', { time: relativeTime(pending.savedAt, locale) })}</span>
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

          <ColumnPicker
            variant="inline"
            columns={columns}
            value={{ columnId: draft.columnId, columnName: draft.columnName }}
            onChange={(pick: ColumnPick) => patch({ columnId: pick.columnId, columnName: pick.columnName })}
            allowCreate={canCreateColumn}
            disabled={disabled}
          />

          <div className="relative mt-3">
            <textarea
              ref={titleRef}
              id="zone-post-title"
              rows={1}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value.replace(/\n/g, ' ') })}
              onKeyDown={onTitleKeyDown}
              placeholder={t('composer_title_placeholder')}
              aria-label={t('composer_title_label')}
              maxLength={ZONE_LIMITS.postTitleMax + 20}
              disabled={disabled}
              autoFocus={!post}
              style={{ fieldSizing: 'content' } as CSSProperties}
              className="w-full resize-none overflow-hidden bg-transparent text-3xl font-semibold leading-tight tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 disabled:opacity-60 dark:text-zinc-50 dark:placeholder:text-zinc-700"
            />
            {titleLen > TITLE_COUNTER_FROM && (
              <span className={`absolute -top-4 right-0 font-mono text-[11px] tabular-nums ${titleLen > ZONE_LIMITS.postTitleMax ? 'text-danger' : 'text-muted'}`}>
                {titleLen}/{ZONE_LIMITS.postTitleMax}
              </span>
            )}
          </div>

          <div className="relative mt-2">
            <input
              ref={summaryRef}
              id="zone-post-summary"
              value={draft.summary}
              onChange={(e) => patch({ summary: e.target.value })}
              placeholder={t('composer_summary_placeholder')}
              aria-label={t('composer_summary_label')}
              maxLength={ZONE_LIMITS.postSummaryMax + 50}
              disabled={disabled}
              className="w-full bg-transparent text-lg text-zinc-600 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-400 dark:placeholder:text-zinc-600"
            />
            {summaryLen > SUMMARY_COUNTER_FROM && (
              <span className={`absolute -top-4 right-0 font-mono text-[11px] tabular-nums ${summaryLen > ZONE_LIMITS.postSummaryMax ? 'text-danger' : 'text-muted'}`}>
                {summaryLen}/{ZONE_LIMITS.postSummaryMax}
              </span>
            )}
          </div>

          <div className="mt-4">
            <RichTextEditor
              value={draft.bodyMd}
              onChange={(bodyMd) => patch({ bodyMd })}
              variant="full"
              chrome="document"
              size="article"
              maxLength={ZONE_LIMITS.postBodyMax}
              placeholder={t('composer_body_placeholder')}
              ariaLabel={t('composer_body_label')}
              disabled={disabled}
              editorRef={editorRef}
              embedPicker={{
                attachments: savedAttachments,
                upload: {
                  zoneSlug: zone.slug,
                  drafts: draft.attachments,
                  // Functional update: two uploads finishing back to back must both land.
                  onUploaded: (d) => setDraft((s) => ({ ...s, attachments: [...s.attachments, d] })),
                  onBusyChange: setEditorUploading,
                },
              }}
            />
          </div>

          <details open={draft.attachments.length > 0} className="group/ledger mt-8">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100">
              <Paperclip className="h-3.5 w-3.5" />
              {t('composer_attachments_toggle', { count: draft.attachments.length })}
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/ledger:rotate-90" aria-hidden />
            </summary>
            <div className="mt-3">
              <AttachmentUploader
                zoneSlug={zone.slug}
                value={draft.attachments}
                onChange={(attachments) => patch({ attachments })}
                onUploadingChange={setAttachmentUploading}
                disabled={disabled}
                insertedRefs={insertedRefs}
                onInsert={insertFromLedger}
                onRemove={onLedgerRemove}
              />
            </div>
          </details>
        </div>

        <ComposerSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          disabled={disabled}
          zoneSlug={zone.slug}
          selfHandle={currentUser.handle}
          selfUserId={currentUser.id}
          cover={draft.cover}
          coverBusy={coverBusy}
          onPickCover={(f) => void uploadCover(f)}
          onRemoveCover={() => patch({ cover: null })}
          linkUrl={draft.linkUrl}
          onLinkChange={(linkUrl) => patch({ linkUrl })}
          tags={draft.tags}
          onTagsChange={(tags) => patch({ tags })}
          coauthors={draft.coauthors}
          onCoauthorsChange={(coauthors) => patch({ coauthors })}
          visibility={draft.visibility}
          onVisibilityChange={(visibility) => patch({ visibility })}
          access={{
            postId: post?.id ?? null,
            serverRestricted: post?.visibility === 'restricted',
            designated: draft.designated,
            onDesignatedChange: (designated) => patch({ designated }),
            accessCode,
            onAccessCodeChange: setAccessCode,
            regenerate: regenerateCode,
            onRegenerateChange: setRegenerateCode,
          }}
          charCount={charCount}
          readMinutes={readMinutes}
          onReset={reset}
          saveLabel={saveLabel}
          onSaveDraft={() => submit('draft')}
          uploading={uploading}
        />
      </div>
    </div>
  );
}
