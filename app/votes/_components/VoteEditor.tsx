'use client';

// Creator/admin editor for a 投票活动 — the resumable draft workspace:
// every uploaded file becomes a VoteEntry row server-side immediately, so a
// refresh/crash mid-batch loses nothing; naming-rule changes preview live and
// apply server-side; settings save explicitly per section.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Play,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
// 通用的时区↔墙上时间换算（Intl 实现，客户端安全）——全站只有这一份，活动日历
// 也用它；votes 只是它的第二个调用方。
import { toWallDate, zonedWallToUtc } from '@/lib/events/time';
import { RichTextEditor } from '@/components/RichTextEditor';
import { withBasePath } from '@/lib/base-path';
import type { VoteActivityEdit, VoteEntryEditRow } from '@/lib/vote-queries';
import {
  CUSTOM_FIELD_LABEL_MAX,
  DEFAULT_NAME_RULE,
  MAX_CUSTOM_FIELDS,
  applyNameRule,
  parseNameRule,
  VOTE_ANNOUNCEMENT_MAX,
  VOTE_TIMEZONES,
  formatVoteInstant,
  resolveWallToInstant,
  voteTimezoneKey,
  VOTE_TITLE_MAX,
  VOTES_PER_USER_MAX,
  MAX_PER_ENTRY_MAX,
  voteTimezoneOf,
  type VoteCustomField,
  type VoteFieldPick,
  type VoteNameRule,
} from '@/lib/votes/shared';
import { probeAndCapture, uploadVoteMedia } from './vote-upload';
import { PosterDialog } from './PosterDialog';
import { VoteStatsPanel } from './VoteStatsPanel';

type EditorTab = 'info' | 'rules' | 'submission' | 'entries' | 'stats';

function newFieldId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `f${Math.random().toString(36).slice(2, 12)}`;
}

const UPLOAD_CONCURRENCY = 2;

interface UploadTask {
  id: number;
  name: string;
  pct: number;
  status: 'waiting' | 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
}

// 开始/截止时间的两个域：输入框里是**墙上时间**（发起人在所选时区看到的钟面），
// 存库的是真实 UTC 瞬时。两者之间的换算走 zonedWallToUtc / toWallDate（DST 感知）
// —— 用 `new Date('...T10:00')` 会按浏览器时区解释，加西的同事排出来的场次到了
// 多伦多就差三小时，这正是要修的问题。

/** UTC 瞬时 → 该时区的 'YYYY-MM-DDTHH:mm'（datetime-local 的取值）。 */
function isoToWall(iso: string | null, zone: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const wall = toWallDate(d, zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/**
 * 'YYYY-MM-DDTHH:mm'（在 zone 里输入的）→ 真实 UTC 瞬时的 ISO 串。
 * 走 resolveWallToInstant 以处理夏令时缺口（不存在的钟面向后推，而不是悄悄
 * 落回前一小时）。
 */
function wallToIso(v: string, zone: string): string | null {
  if (!v) return null;
  const [date, time] = v.split('T');
  if (!date || !time) return null;
  // datetime-local 有时带秒（'10:00:30'）——只取到分。
  return (
    resolveWallToInstant(date, time.slice(0, 5), zone, zonedWallToUtc, toWallDate)?.toISOString() ?? null
  );
}

// Module-level building blocks — defining these inside VoteEditor would mint a
// new component type per render and remount (defocus) every input on keystroke.

function Section({ heading, hint, children }: { heading: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="surface rounded-2xl border border-zinc-200/70 p-5 dark:border-zinc-800/70">
      <h2 className="text-base font-semibold">{heading}</h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all dark:bg-zinc-900 ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

function FieldPickEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: VoteFieldPick;
  onChange: (v: VoteFieldPick) => void;
}) {
  const t = useTranslations('votes');
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-sm">{label}</span>
      <select
        value={value.mode}
        onChange={(e) => {
          const mode = e.target.value as VoteFieldPick['mode'];
          if (mode === 'segment' || mode === 'from') {
            onChange({ mode, index: 'index' in value ? value.index : 0 });
          } else {
            onChange({ mode } as VoteFieldPick);
          }
        }}
        className="h-9 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <option value="none">{t('ed_pick_none')}</option>
        <option value="full">{t('ed_pick_full')}</option>
        <option value="segment">{t('ed_pick_segment')}</option>
        <option value="from">{t('ed_pick_from')}</option>
      </select>
      {(value.mode === 'segment' || value.mode === 'from') && (
        <label className="flex items-center gap-1.5 text-sm text-muted">
          {t('ed_pick_index')}
          <input
            type="number"
            min={1}
            max={20}
            value={value.index + 1}
            onChange={(e) => {
              const idx = Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10) || 1)) - 1;
              onChange({ mode: value.mode, index: idx });
            }}
            className="h-9 w-16 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
          />
        </label>
      )}
    </div>
  );
}

/** 投稿表单字段要求：必填 / 选填 / 关闭。 */
function FormFieldSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: 'required' | 'optional' | 'off';
  onChange: (v: 'required' | 'optional' | 'off') => void;
}) {
  const t = useTranslations('votes');
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as 'required' | 'optional' | 'off')}
        className="h-8 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <option value="required">{t('ed_field_required')}</option>
        <option value="optional">{t('ed_field_optional')}</option>
        <option value="off">{t('ed_field_off')}</option>
      </select>
    </div>
  );
}

export function VoteEditor({ initial }: { initial: VoteActivityEdit }) {
  const t = useTranslations('votes');
  const locale = useLocale();
  const router = useRouter();

  // ── section states ──
  const [title, setTitle] = useState(initial.title);
  const [announcement, setAnnouncement] = useState(initial.announcement);
  const [descriptionMd, setDescriptionMd] = useState(initial.descriptionMd);
  const [coverUrl, setCoverUrl] = useState(initial.coverUrl);
  const [status, setStatus] = useState(initial.status);
  const [closedAt, setClosedAt] = useState(initial.closedAt);

  const [votesPerUser, setVotesPerUser] = useState(initial.votesPerUser);
  const [budgetPeriod, setBudgetPeriod] = useState(initial.budgetPeriod);
  const [maxPerEntry, setMaxPerEntry] = useState(initial.maxPerEntry);
  const [allowRevoke, setAllowRevoke] = useState(initial.allowRevoke);
  const [resultsMode, setResultsMode] = useState(initial.resultsMode);
  const [showTitles, setShowTitles] = useState(initial.showTitles);
  const [showAuthors, setShowAuthors] = useState(initial.showAuthors);
  const [entryOrder, setEntryOrder] = useState(initial.entryOrder);
  // 时区 + 墙上时间是一组：切换时区**保留钟面**（“我说的是下午 2 点温哥华时间”），
  // 瞬时在保存时才由 wallToIso 换算出来。
  const [timezone, setTimezone] = useState(voteTimezoneOf(initial.timezone));
  const [startLocal, setStartLocal] = useState(isoToWall(initial.startAt, voteTimezoneOf(initial.timezone)));
  const [endLocal, setEndLocal] = useState(isoToWall(initial.endAt, voteTimezoneOf(initial.timezone)));
  // 已落库的排期。发布提示只能照着它说话 —— 拿没保存的输入框去承诺"投票将于 X
  // 开放"，而用户没点保存就去发布，结果是当场开投，提示恰好说反。
  const [savedStartAt, setSavedStartAt] = useState(initial.startAt);

  const [allowSubmissions, setAllowSubmissions] = useState(initial.allowSubmissions);
  const [submissionReview, setSubmissionReview] = useState(initial.submissionReview);
  const [submissionMedia, setSubmissionMedia] = useState(initial.submissionMedia);
  const [maxSubmissionsPerUser, setMaxSubmissionsPerUser] = useState(initial.maxSubmissionsPerUser);
  const [maxMbStr, setMaxMbStr] = useState(initial.maxSubmissionMb ? String(initial.maxSubmissionMb) : '');
  const [submitTitleField, setSubmitTitleField] = useState(initial.submitTitle);
  const [submitAuthorNameField, setSubmitAuthorNameField] = useState(initial.submitAuthorName);
  const [submitAuthorNoField, setSubmitAuthorNoField] = useState(initial.submitAuthorNo);
  const [submitDescField, setSubmitDescField] = useState(initial.submitDescription);
  const [customFields, setCustomFields] = useState<VoteCustomField[]>(initial.customFields);
  const [submissionNote, setSubmissionNote] = useState(initial.submissionNote);
  const [allowComments, setAllowComments] = useState(initial.allowComments);
  const [savingSubmission, setSavingSubmission] = useState(false);
  // 分页签：设置项太多，一屏全铺让人无从下手 — 归类后按需展开。
  const [tab, setTab] = useState<EditorTab>('info');
  // 封面编辑对话框（作品表 → 封面按钮）。
  const [posterEntry, setPosterEntry] = useState<VoteEntryEditRow | null>(null);

  const [entries, setEntries] = useState<VoteEntryEditRow[]>(initial.entries);
  const [rule, setRule] = useState<VoteNameRule>(parseNameRule(initial.nameRule) ?? DEFAULT_NAME_RULE);

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [applyingRule, setApplyingRule] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<File[]>([]);
  const activeRef = useRef(0);
  const taskIdRef = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // Last-SAVED naming values per entry — a focus-then-blur with no change must
  // not PATCH (the server would otherwise have to distinguish it, and the row
  // would silently gain titleEdited and dodge 重新应用规则).
  const savedNamingRef = useRef<Map<string, { title: string; authorName: string; authorNo: string }> | null>(null);
  if (savedNamingRef.current === null) {
    savedNamingRef.current = new Map(
      initial.entries.map((e) => [e.id, { title: e.title, authorName: e.authorName, authorNo: e.authorNo }]),
    );
  }

  const uploadingCount = tasks.filter((x) => x.status === 'uploading' || x.status === 'processing' || x.status === 'waiting').length;

  useEffect(() => {
    if (uploadingCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uploadingCount]);

  async function patchActivity(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/votes/${initial.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = String(data?.error ?? '');
        pushToast(
          'error',
          code === 'end_before_start'
            ? t('ed_end_before_start')
            : code === 'start_locked'
              ? t('ed_start_locked')
              : code === 'no_entries'
              ? t('ed_no_entries')
              : code === 'deadline_passed'
                ? t('ed_deadline_passed')
                : code === 'budget_period_locked'
                  ? t('ed_budget_locked')
                  : t('ed_save_failed'),
        );
        return false;
      }
      return true;
    } catch {
      pushToast('error', t('ed_save_failed'));
      return false;
    }
  }

  // ── section saves ──
  async function saveInfo() {
    if (!title.trim()) {
      pushToast('error', t('ed_title_required'));
      return;
    }
    setSavingInfo(true);
    const ok = await patchActivity({
      title: title.trim(),
      announcement: announcement.trim(),
      descriptionMd,
    });
    setSavingInfo(false);
    if (ok) pushToast('success', t('ed_saved'));
  }

  async function saveRules() {
    setSavingRules(true);
    const ok = await patchActivity({
      votesPerUser,
      budgetPeriod,
      maxPerEntry,
      allowRevoke,
      resultsMode,
      showTitles,
      showAuthors,
      entryOrder,
      allowComments,
      timezone,
      startAt: wallToIso(startLocal, timezone),
      endAt: wallToIso(endLocal, timezone),
    });
    setSavingRules(false);
    if (ok) {
      setSavedStartAt(wallToIso(startLocal, timezone));
      pushToast('success', t('ed_saved'));
    }
  }

  async function saveSubmissionSettings() {
    const mb = maxMbStr.trim() === '' ? null : Number.parseInt(maxMbStr, 10);
    if (mb !== null && (!Number.isFinite(mb) || mb < 1 || mb > 102400)) {
      pushToast('error', t('ed_sub_mb_invalid'));
      return;
    }
    setSavingSubmission(true);
    const cleanedFields = customFields
      .map((f) => ({ ...f, label: f.label.trim() }))
      .filter((f) => f.label.length > 0);
    const ok = await patchActivity({
      allowSubmissions,
      submissionReview,
      submissionMedia,
      maxSubmissionsPerUser,
      maxSubmissionMb: mb,
      submitTitle: submitTitleField,
      submitAuthorName: submitAuthorNameField,
      submitAuthorNo: submitAuthorNoField,
      submitDescription: submitDescField,
      submissionFields: cleanedFields,
      submissionNote: submissionNote.trim(),
    });
    if (ok) setCustomFields(cleanedFields);
    setSavingSubmission(false);
    if (ok) pushToast('success', t('ed_saved'));
  }

  // ── cover ──
  async function pickCover(file: File) {
    if (!file.type.startsWith('image/')) {
      pushToast('error', t('ed_unsupported_type'));
      return;
    }
    setCoverBusy(true);
    try {
      const up = await uploadVoteMedia(initial.id, file, file.name, 'cover');
      if (up.key && (await patchActivity({ coverKey: up.key }))) {
        setCoverUrl(up.url ?? null);
        pushToast('success', t('ed_saved'));
      }
    } catch (e) {
      pushToast('error', t(uploadErrorKey(e)));
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeCover() {
    setCoverBusy(true);
    if (await patchActivity({ coverKey: null })) setCoverUrl(null);
    setCoverBusy(false);
  }

  // ── upload queue ──
  function uploadErrorKey(e: unknown): string {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'file_too_large') return 'ed_file_too_large';
    if (msg === 'unsupported_type') return 'ed_unsupported_type';
    if (msg === 'rate_limited') return 'ed_rate_limited';
    if (msg === 'vote_over') return 'ed_vote_over';
    return 'ed_upload_failed';
  }

  function updateTask(id: number, patch: Partial<UploadTask>) {
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  async function runUpload(file: File, taskId: number) {
    const isVideo = file.type.startsWith('video/');
    try {
      updateTask(taskId, { status: isVideo ? 'processing' : 'uploading' });
      let durationSec = 0;
      let poster: Blob | null = null;
      let portrait = false;
      if (isVideo) {
        const objectUrl = URL.createObjectURL(file);
        try {
          const probed = await probeAndCapture(objectUrl);
          durationSec = probed.meta.duration;
          poster = probed.poster;
          // 竖屏素材走竖版卡片 —— 卡片框按 posterAspect 画，9:16 的片子塞进
          // 横版框会被裁掉大半。发起人仍可在「封面」里改回横版。
          portrait = probed.meta.height > probed.meta.width;
        } catch {
          /* best-effort — upload without poster/duration */
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        updateTask(taskId, { status: 'uploading' });
      }
      const res = await uploadVoteMedia(initial.id, file, file.name, isVideo ? 'video' : 'image', {
        durationSec,
        onProgress: (pct) => updateTask(taskId, { pct }),
      });
      if (!res.entry) throw new Error('upload_failed');
      let entry = res.entry;
      savedNamingRef.current?.set(entry.id, {
        title: entry.title,
        authorName: entry.authorName,
        authorNo: entry.authorNo,
      });
      if (isVideo && poster) {
        try {
          const posterRes = await uploadVoteMedia(initial.id, poster, `${file.name}.jpg`, 'poster', {
            entryId: entry.id,
          });
          if (posterRes.url) entry = { ...entry, posterUrl: posterRes.url };
        } catch {
          /* poster is best-effort */
        }
      }
      if (portrait) {
        // 上传接口不带这个字段，补一发 PATCH；失败了也只是回到横版默认值。
        try {
          await fetch(`/api/votes/${initial.id}/entries/${entry.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ posterAspect: 'portrait' }),
          });
          entry = { ...entry, posterAspect: 'portrait' };
        } catch {
          /* best-effort */
        }
      }
      setEntries((prev) => [...prev, entry as VoteEntryEditRow]);
      updateTask(taskId, { status: 'done', pct: 100 });
    } catch (e) {
      updateTask(taskId, { status: 'error', error: t(uploadErrorKey(e)) });
    }
  }

  function pump() {
    while (activeRef.current < UPLOAD_CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      const meta = next as File & { __taskId?: number };
      const taskId = meta.__taskId ?? -1;
      activeRef.current += 1;
      void runUpload(next, taskId).finally(() => {
        activeRef.current -= 1;
        pump();
      });
    }
  }

  function enqueueFiles(files: FileList | File[]) {
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) accepted.push(file);
    }
    if (accepted.length === 0) {
      pushToast('error', t('ed_unsupported_type'));
      return;
    }
    const newTasks: UploadTask[] = accepted.map((file) => {
      const id = ++taskIdRef.current;
      (file as File & { __taskId?: number }).__taskId = id;
      return { id, name: file.name, pct: 0, status: 'waiting' as const };
    });
    setTasks((prev) => [...prev, ...newTasks]);
    queueRef.current.push(...accepted);
    pump();
  }

  // ── naming rule ──
  const previewRows = useMemo(() => {
    const sample = entries.slice(0, 6);
    return sample.map((e) => ({ entry: e, parsed: applyNameRule(e.originalName, rule) }));
  }, [entries, rule]);

  async function applyRule() {
    // Capture what we POST — the user may keep editing the rule while the
    // request is in flight, and the local mirror must match the SERVER's apply.
    const posted = rule;
    setApplyingRule(true);
    try {
      const res = await fetch(`/api/votes/${initial.id}/apply-rule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rule: posted }),
      });
      if (!res.ok) {
        pushToast('error', t('ed_save_failed'));
        return;
      }
      // Same pure function server-side ⇒ mirror locally for hand-untouched rows.
      setEntries((prev) =>
        prev.map((e) => {
          if (e.titleEdited) return e;
          const parsed = applyNameRule(e.originalName, posted);
          savedNamingRef.current?.set(e.id, {
            title: parsed.title,
            authorName: parsed.authorName,
            authorNo: parsed.authorNo,
          });
          return { ...e, title: parsed.title, authorName: parsed.authorName, authorNo: parsed.authorNo };
        }),
      );
      pushToast('success', t('ed_rule_applied'));
    } catch {
      pushToast('error', t('ed_save_failed'));
    } finally {
      setApplyingRule(false);
    }
  }

  // ── entry mutations ──
  async function patchEntry(entry: VoteEntryEditRow, body: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/votes/${initial.id}/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', t('ed_save_failed'));
        return;
      }
      if (data.entry) {
        savedNamingRef.current?.set(entry.id, {
          title: data.entry.title,
          authorName: data.entry.authorName,
          authorNo: data.entry.authorNo,
        });
      }
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...data.entry } : e)));
    } catch {
      pushToast('error', t('ed_save_failed'));
    }
  }

  /** Blur handler for the naming cells — skips the PATCH when nothing changed. */
  function saveNamingField(
    entry: VoteEntryEditRow,
    field: 'title' | 'authorName' | 'authorNo',
    value: string,
  ) {
    const saved = savedNamingRef.current?.get(entry.id);
    const normalized = field === 'authorNo' ? value.trim().toLowerCase() : value.trim();
    if (saved && saved[field] === normalized) return;
    void patchEntry(entry, { [field]: value });
  }

  function editEntryField(id: string, patch: Partial<VoteEntryEditRow>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function deleteEntry(entry: VoteEntryEditRow) {
    const warn = entry.voteCount > 0 ? t('ed_delete_entry_votes', { count: entry.voteCount }) : t('ed_delete_entry');
    if (!window.confirm(warn)) return;
    try {
      const res = await fetch(`/api/votes/${initial.id}/entries/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('ed_save_failed'));
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      pushToast('error', t('ed_save_failed'));
    }
  }

  // ── lifecycle ──
  async function publish() {
    // 开成员投稿时允许“空场”发布（征集期先行）；服务端按已保存的设置权威校验。
    if (!allowSubmissions && entries.filter((e) => !e.hidden && e.status === 'approved').length === 0) {
      pushToast('error', t('ed_no_entries'));
      return;
    }
    setLifecycleBusy(true);
    // 排期改了还没保存就点发布：先把规则落库，再发布。否则"到点才开投"会变成
    // "立刻开投"，而用户刚刚读到的提示写的是前者。
    if (scheduleDirty) {
      const saved = await patchActivity({
        timezone,
        startAt: wallToIso(startLocal, timezone),
        endAt: wallToIso(endLocal, timezone),
      });
      if (!saved) {
        setLifecycleBusy(false);
        return;
      }
      setSavedStartAt(wallToIso(startLocal, timezone));
    }
    const ok = await patchActivity({ publish: true });
    setLifecycleBusy(false);
    if (ok) {
      pushToast('success', t('ed_published'));
      router.push(`/votes/${initial.id}`);
      router.refresh();
    }
  }

  async function toggleClosed(nextClosed: boolean) {
    if (nextClosed && !window.confirm(t('ed_close_confirm'))) return;
    setLifecycleBusy(true);
    const ok = await patchActivity({ closed: nextClosed });
    setLifecycleBusy(false);
    if (ok) {
      setClosedAt(nextClosed ? new Date().toISOString() : null);
      pushToast('success', nextClosed ? t('ed_closed') : t('ed_reopened'));
      router.refresh();
    }
  }

  async function deleteActivity() {
    if (!window.confirm(t('ed_delete_confirm'))) return;
    setLifecycleBusy(true);
    try {
      const res = await fetch(`/api/votes/${initial.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('ed_save_failed'));
        return;
      }
      pushToast('success', t('ed_deleted'));
      router.push('/votes');
      router.refresh();
    } catch {
      pushToast('error', t('ed_save_failed'));
    } finally {
      setLifecycleBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400';
  const smallInputCls =
    'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition hover:border-zinc-200 focus:border-zinc-400 dark:hover:border-zinc-700 dark:focus:border-zinc-500';
  const btnSecondary =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800';
  const btnPrimary =
    'inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';

  const isClosed = Boolean(closedAt);
  // 与 recountVisibleEntries 同口径：待审核/已驳回不算可见作品。
  const visibleCount = entries.filter((e) => !e.hidden && e.status === 'approved').length;
  // 已排期且还没到点 → 发布提示要说清楚“先浏览、到点才开投”。
  const scheduledStartIso =
    savedStartAt && new Date(savedStartAt).getTime() > Date.now() ? savedStartAt : null;
  // 输入框里的排期和已落库的不一致 —— 发布前必须先落库，否则提示与实际相反。
  const scheduleDirty = wallToIso(startLocal, timezone) !== savedStartAt;

  return (
    <div className="space-y-6">
      {/* top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t('ed_title')}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              status === 'draft'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                : isClosed || initial.over
                  ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
            }`}
          >
            {status === 'draft' ? t('badge_draft') : isClosed || initial.over ? t('badge_ended') : t('badge_ongoing')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/votes/${initial.id}`} className={btnSecondary}>
            <Eye className="h-4 w-4" />
            {t('ed_preview')}
          </Link>
          {status === 'draft' ? (
            <button type="button" onClick={() => void publish()} disabled={lifecycleBusy} className={btnPrimary}>
              {lifecycleBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('ed_publish')}
            </button>
          ) : isClosed ? (
            <button type="button" onClick={() => void toggleClosed(false)} disabled={lifecycleBusy} className={btnSecondary}>
              {t('ed_reopen')}
            </button>
          ) : (
            <button type="button" onClick={() => void toggleClosed(true)} disabled={lifecycleBusy} className={btnSecondary}>
              {t('ed_close')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void deleteActivity()}
            disabled={lifecycleBusy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-4 w-4" />
            {t('ed_delete')}
          </button>
        </div>
      </div>

      {/* 页签导航 */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
        {(
          [
            ['info', t('ed_tab_info')],
            ['rules', t('ed_tab_rules')],
            ['submission', t('ed_tab_submission')],
            [
              'entries',
              `${t('ed_tab_entries')} (${entries.length})${
                entries.some((e) => e.status === 'pending')
                  ? ` · ${t('ed_pending_n', { count: entries.filter((e) => e.status === 'pending').length })}`
                  : ''
              }`,
            ],
            ['stats', t('ed_tab_stats')],
          ] as [EditorTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              tab === key
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 基本信息 */}
      {tab === 'info' && (
      <Section heading={t('ed_info_heading')}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('create_name_label')}</label>
            <input value={title} maxLength={VOTE_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_announcement_label')}</label>
            <input
              value={announcement}
              maxLength={VOTE_ANNOUNCEMENT_MAX}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder={t('ed_announcement_placeholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_description_label')}</label>
            <RichTextEditor value={descriptionMd} onChange={setDescriptionMd} variant="compact" maxLength={20000} placeholder={t('ed_description_placeholder')} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_cover_label')}</label>
            <div className="flex items-center gap-3">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={withBasePath(coverUrl)} alt="" className="h-16 w-32 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700">
                  <ImagePlus className="h-5 w-5" />
                </div>
              )}
              <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} className={btnSecondary}>
                {coverBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {coverUrl ? t('ed_cover_replace') : t('ed_cover_upload')}
              </button>
              {coverUrl && (
                <button type="button" onClick={() => void removeCover()} disabled={coverBusy} className={btnSecondary}>
                  {t('ed_cover_remove')}
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickCover(f);
                  e.target.value = '';
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">{t('ed_cover_hint')}</p>
          </div>
          <div>
            <button type="button" onClick={() => void saveInfo()} disabled={savingInfo} className={btnPrimary}>
              {savingInfo && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('ed_save')}
            </button>
          </div>
        </div>
      </Section>
      )}

      {/* 投票规则 */}
      {tab === 'rules' && (
      <Section heading={t('ed_rules_heading')} hint={t('ed_rules_hint')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_budget_period')}</label>
            <select
              value={budgetPeriod}
              onChange={(e) => setBudgetPeriod(e.target.value as 'total' | 'daily')}
              disabled={initial.voterCount > 0}
              className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <option value="total">{t('ed_budget_total')}</option>
              <option value="daily">{t('ed_budget_daily')}</option>
            </select>
            {initial.voterCount > 0 && (
              <p className="mt-1 text-xs text-muted">{t('ed_budget_locked')}</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {budgetPeriod === 'daily' ? t('ed_votes_per_user_daily') : t('ed_votes_per_user')}
            </label>
            <input
              type="number"
              min={1}
              max={VOTES_PER_USER_MAX}
              value={votesPerUser}
              onChange={(e) => setVotesPerUser(Math.max(1, Math.min(VOTES_PER_USER_MAX, Number.parseInt(e.target.value, 10) || 1)))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {budgetPeriod === 'daily' ? t('ed_max_per_entry_daily') : t('ed_max_per_entry')}
            </label>
            <input
              type="number"
              min={1}
              max={MAX_PER_ENTRY_MAX}
              value={maxPerEntry}
              onChange={(e) => setMaxPerEntry(Math.max(1, Math.min(MAX_PER_ENTRY_MAX, Number.parseInt(e.target.value, 10) || 1)))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_results_mode')}</label>
            <select
              value={resultsMode}
              onChange={(e) => setResultsMode(e.target.value as typeof resultsMode)}
              className={inputCls}
            >
              <option value="after_end">{t('rule_results_after_end')}</option>
              <option value="realtime">{t('rule_results_realtime')}</option>
              <option value="creator_only">{t('rule_results_creator_only')}</option>
            </select>
          </div>
          {/* 开始/截止/时区是一组：时区管着上面两个输入框的钟面，分开摆会让人
              以为填的是自己电脑的本地时间。 */}
          <div className="sm:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('ed_start_at')}</label>
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('ed_end_at')}</label>
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('ed_timezone')}</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(voteTimezoneOf(e.target.value))}
                  className={inputCls}
                >
                  {VOTE_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {t(tz.key)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted">{t('ed_timezone_hint')}</p>
            {initial.timezone === null && (initial.startAt || initial.endAt) && (
              <p className="mt-1 text-xs text-muted">{t('ed_timezone_legacy_hint')}</p>
            )}
            <p className="mt-1 text-xs text-muted">{t('ed_start_at_hint')}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('ed_entry_order')}</label>
            <select value={entryOrder} onChange={(e) => setEntryOrder(e.target.value as typeof entryOrder)} className={inputCls}>
              <option value="random">{t('ed_order_random')}</option>
              <option value="upload">{t('ed_order_upload')}</option>
              <option value="votes">{t('ed_order_votes')}</option>
            </select>
          </div>
          <div className="space-y-2 sm:pt-6">
            <Toggle checked={allowRevoke} onChange={setAllowRevoke} label={t('ed_allow_revoke')} />
          </div>
          <Toggle checked={showTitles} onChange={setShowTitles} label={t('ed_show_titles')} />
          <Toggle checked={showAuthors} onChange={setShowAuthors} label={t('ed_show_authors')} />
          <Toggle checked={allowComments} onChange={setAllowComments} label={t('ed_allow_comments')} />
        </div>
        <p className="mt-3 text-xs text-muted">{t('ed_anonymous_note')}</p>
        <div className="mt-4">
          <button type="button" onClick={() => void saveRules()} disabled={savingRules} className={btnPrimary}>
            {savingRules && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('ed_save')}
          </button>
        </div>
      </Section>
      )}

      {/* 投稿设置 */}
      {tab === 'submission' && (
      <Section heading={t('ed_sub_heading')} hint={t('ed_sub_hint')}>
        <div className="space-y-4">
          <Toggle checked={allowSubmissions} onChange={setAllowSubmissions} label={t('ed_sub_allow')} />
          {allowSubmissions && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:pt-0">
                  <Toggle checked={submissionReview} onChange={setSubmissionReview} label={t('ed_sub_review')} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t('ed_sub_media')}</label>
                  <select
                    value={submissionMedia}
                    onChange={(e) => setSubmissionMedia(e.target.value as typeof submissionMedia)}
                    className={inputCls}
                  >
                    <option value="both">{t('ed_sub_media_both')}</option>
                    <option value="image">{t('ed_sub_media_image')}</option>
                    <option value="video">{t('ed_sub_media_video')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t('ed_sub_max_per_user')}</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxSubmissionsPerUser}
                    onChange={(e) =>
                      setMaxSubmissionsPerUser(Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 1)))
                    }
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t('ed_sub_max_mb')}</label>
                  <input
                    type="number"
                    min={1}
                    max={102400}
                    value={maxMbStr}
                    onChange={(e) => setMaxMbStr(e.target.value)}
                    placeholder={t('ed_sub_max_mb_placeholder')}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{t('ed_sub_fields')}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <FormFieldSelect label={t('ed_field_title')} value={submitTitleField} onChange={setSubmitTitleField} />
                  <FormFieldSelect
                    label={t('ed_field_author')}
                    value={submitAuthorNameField}
                    onChange={setSubmitAuthorNameField}
                  />
                  <FormFieldSelect
                    label={t('ed_field_author_no')}
                    value={submitAuthorNoField}
                    onChange={setSubmitAuthorNoField}
                  />
                  <FormFieldSelect
                    label={t('ed_field_description')}
                    value={submitDescField}
                    onChange={setSubmitDescField}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted">{t('ed_sub_fields_hint2')}</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{t('ed_custom_fields')}</p>
                <div className="space-y-2">
                  {customFields.map((field, idx) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <input
                        value={field.label}
                        maxLength={CUSTOM_FIELD_LABEL_MAX}
                        placeholder={t('ed_custom_field_placeholder')}
                        onChange={(e) =>
                          setCustomFields((prev) =>
                            prev.map((f, i) => (i === idx ? { ...f, label: e.target.value } : f)),
                          )
                        }
                        className={inputCls}
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            setCustomFields((prev) =>
                              prev.map((f, i) => (i === idx ? { ...f, required: e.target.checked } : f)),
                            )
                          }
                          className="h-3.5 w-3.5"
                        />
                        {t('ed_field_required')}
                      </label>
                      <button
                        type="button"
                        title={t('ed_custom_field_remove')}
                        onClick={() => setCustomFields((prev) => prev.filter((_, i) => i !== idx))}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {customFields.length < MAX_CUSTOM_FIELDS && (
                    <button
                      type="button"
                      onClick={() =>
                        setCustomFields((prev) => [...prev, { id: newFieldId(), label: '', required: false }])
                      }
                      className="text-sm font-medium text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
                    >
                      + {t('ed_custom_field_add')}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted">{t('ed_custom_fields_hint')}</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('ed_sub_note')}</label>
                <textarea
                  value={submissionNote}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setSubmissionNote(e.target.value)}
                  placeholder={t('ed_sub_note_placeholder')}
                  className={inputCls}
                />
              </div>
              <p className="text-xs text-muted">{t('ed_sub_window_hint')}</p>
            </>
          )}
          <div>
            <button type="button" onClick={() => void saveSubmissionSettings()} disabled={savingSubmission} className={btnPrimary}>
              {savingSubmission && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('ed_save')}
            </button>
          </div>
        </div>
      </Section>
      )}

      {/* 作品：上传 + 命名规则 + 列表 */}
      {tab === 'entries' && (
        <>
      <Section heading={t('ed_upload_heading')} hint={t('ed_upload_hint')}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) enqueueFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragOver
              ? 'border-zinc-500 bg-zinc-100/70 dark:border-zinc-400 dark:bg-zinc-800/50'
              : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
          }`}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
        >
          <Upload className="h-6 w-6 text-zinc-400" />
          <p className="mt-2 text-sm font-medium">{t('ed_dropzone_title')}</p>
          <p className="mt-1 text-xs text-muted">{t('ed_dropzone_hint')}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) enqueueFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {tasks.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {uploadingCount > 0 && (
              <p className="text-xs text-muted">{t('ed_uploading_n', { count: uploadingCount })}</p>
            )}
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {tasks
                .slice()
                .reverse()
                .map((task) => (
                  <div key={task.id} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : task.status === 'error' ? (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{task.name}</span>
                    {task.status === 'uploading' && (
                      <span className="w-28 shrink-0">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <span
                            className="block h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                            style={{ width: `${Math.round(task.pct)}%` }}
                          />
                        </span>
                      </span>
                    )}
                    {task.status === 'processing' && <span className="shrink-0 text-muted">{t('ed_task_processing')}</span>}
                    {task.status === 'waiting' && <span className="shrink-0 text-muted">{t('ed_task_waiting')}</span>}
                    {task.status === 'error' && <span className="shrink-0 text-red-500">{task.error}</span>}
                  </div>
                ))}
            </div>
          </div>
        )}
      </Section>

      {/* 命名规则 */}
      <Section heading={t('ed_rule_heading')} hint={t('ed_rule_hint')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="w-16 shrink-0 text-sm">{t('ed_rule_prefix')}</label>
              <input
                value={rule.prefix}
                maxLength={60}
                onChange={(e) => setRule({ ...rule, prefix: e.target.value })}
                placeholder={t('ed_rule_prefix_placeholder')}
                className={inputCls}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-16 shrink-0 text-sm">{t('ed_rule_delimiter')}</label>
              <input
                value={rule.delimiter}
                maxLength={8}
                onChange={(e) => setRule({ ...rule, delimiter: e.target.value })}
                placeholder={t('ed_rule_delimiter_placeholder')}
                className={inputCls}
              />
            </div>
            <Toggle checked={rule.stripExt} onChange={(v) => setRule({ ...rule, stripExt: v })} label={t('ed_rule_strip_ext')} />
            <div className="space-y-2.5 pt-1">
              <FieldPickEditor label={t('ed_field_title')} value={rule.title} onChange={(v) => setRule({ ...rule, title: v })} />
              <FieldPickEditor label={t('ed_field_author')} value={rule.author} onChange={(v) => setRule({ ...rule, author: v })} />
              <FieldPickEditor label={t('ed_field_author_no')} value={rule.authorNo} onChange={(v) => setRule({ ...rule, authorNo: v })} />
            </div>
            <button type="button" onClick={() => void applyRule()} disabled={applyingRule || entries.length === 0} className={btnPrimary}>
              {applyingRule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {t('ed_rule_apply')}
            </button>
            <p className="text-xs text-muted">{t('ed_rule_apply_note')}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">{t('ed_rule_preview')}</p>
            {previewRows.length === 0 ? (
              <p className="text-xs text-muted">{t('ed_rule_preview_empty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-muted dark:border-zinc-800">
                      <th className="px-2.5 py-1.5 font-medium">{t('ed_col_filename')}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t('ed_col_title')}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t('ed_col_author')}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t('ed_col_author_no')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ entry, parsed }) => (
                      <tr key={entry.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                        <td className="max-w-[160px] truncate px-2.5 py-1.5 text-muted">{entry.originalName}</td>
                        <td className="px-2.5 py-1.5">{parsed.title || '—'}</td>
                        <td className="px-2.5 py-1.5">{parsed.authorName || '—'}</td>
                        <td className="px-2.5 py-1.5">{parsed.authorNo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* 作品列表 */}
      <Section
        heading={`${t('ed_entries_heading')} (${entries.length})${
          entries.some((e) => e.status === 'pending')
            ? ` · ${t('ed_pending_n', { count: entries.filter((e) => e.status === 'pending').length })}`
            : ''
        }`}
        hint={entries.length > 0 ? t('ed_entries_hint') : undefined}
      >
        {entries.length === 0 ? (
          <p className="text-sm text-muted">{t('ed_entries_empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_preview')}</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_filename')}</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_title')}</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_author')}</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_author_no')}</th>
                  <th className="px-2 py-2 font-medium">{t('ed_col_status')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('ed_col_votes')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('ed_col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const thumb = entry.kind === 'video' ? entry.posterUrl : entry.fileUrl;
                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${entry.hidden ? 'opacity-45' : ''}`}
                    >
                      <td className="px-2 py-2 tabular-nums text-muted">{entry.entryNo}</td>
                      <td className="px-2 py-2">
                        <div className="relative h-12 w-16 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={withBasePath(thumb)} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-400">
                              <Play className="h-4 w-4" />
                            </div>
                          )}
                          {entry.kind === 'video' && (
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
                              {t('ed_kind_video')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-xs text-muted" title={entry.originalName}>
                        {entry.originalName}
                        {entry.titleEdited && (
                          <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[9px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            {t('ed_edited_badge')}
                          </span>
                        )}
                      </td>
                      <td className="min-w-[140px] px-2 py-1">
                        <input
                          value={entry.title}
                          onChange={(e) => editEntryField(entry.id, { title: e.target.value })}
                          onBlur={(e) => saveNamingField(entry, 'title', e.target.value)}
                          className={smallInputCls}
                        />
                      </td>
                      <td className="min-w-[100px] px-2 py-1">
                        <input
                          value={entry.authorName}
                          onChange={(e) => editEntryField(entry.id, { authorName: e.target.value })}
                          onBlur={(e) => saveNamingField(entry, 'authorName', e.target.value)}
                          className={smallInputCls}
                        />
                      </td>
                      <td className="min-w-[90px] px-2 py-1">
                        <input
                          value={entry.authorNo}
                          onChange={(e) => editEntryField(entry.id, { authorNo: e.target.value })}
                          onBlur={(e) => saveNamingField(entry, 'authorNo', e.target.value)}
                          className={smallInputCls}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {entry.status === 'pending' ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            {t('sub_status_pending')}
                          </span>
                        ) : entry.status === 'rejected' ? (
                          <span
                            className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300"
                            title={entry.reviewNote || undefined}
                          >
                            {t('sub_status_rejected')}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                        {entry.submitterName && (
                          <div className="mt-0.5 max-w-[90px] truncate text-[11px] text-muted" title={entry.submitterName}>
                            {entry.submitterName}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{entry.voteCount}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {entry.status !== 'approved' && (
                            <button
                              type="button"
                              title={t('ed_approve')}
                              onClick={() => void patchEntry(entry, { status: 'approved' })}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          {entry.status === 'pending' && (
                            <button
                              type="button"
                              title={t('ed_reject')}
                              onClick={() => {
                                const note = window.prompt(t('ed_reject_prompt'));
                                if (note === null) return; // 取消 ≠ 用空理由驳回
                                void patchEntry(entry, { status: 'rejected', reviewNote: note.slice(0, 500) });
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            title={t('ed_poster_btn')}
                            onClick={() => setPosterEntry(entry)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <ImagePlus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={entry.hidden ? t('ed_unhide') : t('ed_hide')}
                            onClick={() => void patchEntry(entry, { hidden: !entry.hidden })}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            {entry.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            title={t('ed_delete_entry_btn')}
                            onClick={() => void deleteEntry(entry)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {status === 'draft' && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {scheduledStartIso
              ? t('ed_publish_note_scheduled', {
                  count: visibleCount,
                  time: `${formatVoteInstant(scheduledStartIso, timezone, locale)} ${t(voteTimezoneKey(timezone))}`,
                })
              : t('ed_publish_note', { count: visibleCount })}
          </div>
        )}
      </Section>

      </>
      )}

      {/* 数据 */}
      {tab === 'stats' && (
        <Section heading={t('ed_stats_heading')} hint={t('ed_stats_hint')}>
          <div className="mb-4 flex flex-wrap items-center gap-6 text-sm">
            <div>
              <div className="text-2xl font-bold tabular-nums">{visibleCount}</div>
              <div className="text-xs text-muted">{t('ed_stat_entries')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{initial.voterCount}</div>
              <div className="text-xs text-muted">{t('ed_stat_voters')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{initial.voteCount}</div>
              <div className="text-xs text-muted">{t('ed_stat_votes')}</div>
            </div>
            <div className="ml-auto">
              <a href={withBasePath(`/api/votes/${initial.id}/export`)} className={btnSecondary}>
                {t('ed_export_full')}
              </a>
            </div>
          </div>
          <VoteStatsPanel activityId={initial.id} />
        </Section>
      )}

      {posterEntry && (
        <PosterDialog
          activityId={initial.id}
          entry={posterEntry}
          onClose={() => setPosterEntry(null)}
          onSaved={(patch) => {
            setEntries((prev) => prev.map((e) => (e.id === posterEntry.id ? { ...e, ...patch } : e)));
            setPosterEntry((prev) => (prev ? { ...prev, ...patch } : prev));
          }}
        />
      )}
    </div>
  );
}
