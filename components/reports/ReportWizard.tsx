'use client';

// 「聊天记录 → 报告」工具 — 新建向导（docs/contracts/reports.md §2a / §2b）。不经过任何版块。
//
// 用户把 WeLink 导出 / welink-cli 拉下来的那个目录整个交上来就行：选文件夹、选 zip、或多选文件，
// 三种方式最后都是「一个 zip、一次上传」——文件夹 / 多选在浏览器里用 JSZip 打成 zip（图片 STORE，
// 文本 DEFLATE），zip 原样上传。识别规则在 lib/zones/reports/bundle.ts，和服务端解包的是同一份，
// 所以这里展示的识别结果就是流水线会用的：聊天记录 / 清单 / 图片与文件 / report.json（有它就
// 走导入模式，不调模型）。「补充要求」进每一步提示词（追加 / 取代默认写法）。
// 然后 POST /api/tools/chat-report { bundleKey, instructions… } 建任务，跳到详情页轮询。

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import JSZip from 'jszip';
import { Check, FolderOpen, FileArchive, Files, Loader2, Upload, X } from 'lucide-react';
import { DEFAULT_WRITING_GUIDE } from '@/lib/zones/reports/writing-guide';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { MAX_ZONE_FILE_BYTES } from '@/lib/zones/shared';
import { BUNDLE_IMAGE_RE, bundleBasename, bundleHasChat, HEAD_BYTES, isTextLike, MAX_SNIFF_BYTES, planReportBundle, type BundleFile } from '@/lib/zones/reports/bundle';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLS, LABEL_CLS, HINT_CLS, SELECT_CLS, CARD_CLS, TEXTAREA_CLS } from '@/app/zones/_components/ui';

type Kind = 'daily' | 'weekly' | 'monthly' | 'custom';

interface Picked extends BundleFile {
  file: File;
}

/** 一个 zip 里的条目（浏览器端只读目录，用于识别预览）。 */
interface ZipEntry extends BundleFile {
  entry: JSZip.JSZipObject;
}

async function uploadBundle(blob: Blob, name: string): Promise<string> {
  const res = await fetch('/api/tools/chat-report/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/zip', 'x-filename': encodeURIComponent(name) },
    body: blob,
  });
  const data = (await res.json().catch(() => ({}))) as { key?: string; reason?: string; error?: string };
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? '2');
    await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
    return uploadBundle(blob, name);
  }
  if (!res.ok || !data.key) throw new Error(data.reason ?? data.error ?? 'upload failed');
  return data.key;
}

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function ReportWizard({ defaultSubject = '' }: { defaultSubject?: string }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('monthly');
  const [subject, setSubject] = useState(defaultSubject);
  const [instructions, setInstructions] = useState('');
  const [instructionMode, setInstructionMode] = useState<'append' | 'override'>('append');
  const [showGuide, setShowGuide] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipEntries, setZipEntries] = useState<ZipEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const plan = useMemo(() => planReportBundle<BundleFile>(zipFile ? (zipEntries ?? []) : picked), [picked, zipFile, zipEntries]);
  const totalBytes = zipFile ? zipFile.size : picked.reduce((n, p) => n + p.size, 0);
  const hasChat = bundleHasChat(plan);
  const ready = hasChat && !busy && (!zipFile || zipEntries !== null);

  function clear() {
    setPicked([]);
    setZipFile(null);
    setZipEntries(null);
  }

  /** 文本类文件读开头几 KB，识别按内容走（bundle.ts sniffText），文件名随便叫。 */
  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next: Picked[] = [];
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      let head: string | undefined;
      if (isTextLike(rel) && f.size <= MAX_SNIFF_BYTES) {
        try {
          head = await f.slice(0, HEAD_BYTES).text();
        } catch {
          head = undefined;
        }
      }
      next.push({ path: rel, size: f.size, head, file: f });
    }
    setZipFile(null);
    setZipEntries(null);
    setPicked((prev) => {
      const seen = new Set(prev.map((p) => p.path));
      return [...prev, ...next.filter((p) => !seen.has(p.path))];
    });
  }

  async function pickZip(file: File | null) {
    if (!file) return;
    setPicked([]);
    setZipFile(file);
    setZipEntries(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const entries: ZipEntry[] = [];
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 1;
        let head: string | undefined;
        if (isTextLike(path) && size <= MAX_SNIFF_BYTES) {
          try {
            const bytes = await entry.async('uint8array');
            head = new TextDecoder('utf-8').decode(bytes.subarray(0, HEAD_BYTES));
          } catch {
            head = undefined;
          }
        }
        entries.push({ path, size, head, entry });
      }
      setZipEntries(entries);
    } catch {
      pushToast('error', t('report_bundle_bad_zip'));
      setZipFile(null);
    }
  }

  async function submit() {
    if (!ready) return;
    if (from && to && from > to) {
      pushToast('error', t('report_period_invalid'));
      return;
    }
    if (totalBytes > MAX_ZONE_FILE_BYTES) {
      pushToast('error', t('report_bundle_too_large', { max: fmtSize(MAX_ZONE_FILE_BYTES) }));
      return;
    }
    try {
      let blob: Blob;
      let name: string;
      if (zipFile) {
        blob = zipFile;
        name = zipFile.name;
      } else {
        setBusy(t('report_zipping', { count: picked.length }));
        const zip = new JSZip();
        for (const p of picked) {
          zip.file(p.path, p.file, { compression: BUNDLE_IMAGE_RE.test(p.path) ? 'STORE' : 'DEFLATE', compressionOptions: { level: 3 } });
        }
        blob = await zip.generateAsync({ type: 'blob' });
        name = `${subject.trim() || 'chat'}-bundle.zip`;
      }
      setBusy(t('report_uploading', { name }));
      const bundleKey = await uploadBundle(blob, name);
      setBusy(t('report_creating'));
      const res = await fetch('/api/tools/chat-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), kind, subject: subject.trim(), periodStart: from || null, periodEnd: to || null, bundleKey, instructions: instructions.trim(), instructionMode }),
      });
      if (res.status === 401) {
        router.push(currentLoginHref());
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; reason?: string };
      if (!res.ok || !data.id) {
        pushToast('error', data.reason ?? t('report_create_failed'));
        return;
      }
      router.push(`/tools/chat-report/${data.id}`);
    } catch (e) {
      pushToast('error', (e as Error).message || t('report_create_failed'));
    } finally {
      setBusy(null);
    }
  }

  const images = plan.assets.filter((a) => a.kind === 'image').length;
  const files = plan.assets.length - images;
  const hasAny = zipFile !== null || picked.length > 0;

  const row = (ok: boolean, label: string, detail?: string) => (
    <li className={`flex items-start gap-2 ${ok ? '' : 'text-muted'}`}>
      {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <span>
        {label}
        {detail ? <span className="ml-2 font-mono text-xs text-muted">{detail}</span> : null}
      </span>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <label className={LABEL_CLS}>{t('report_bundle')}</label>
        <div className={`${CARD_CLS} px-4 py-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => folderInput.current?.click()} className={BTN_SECONDARY} disabled={!!busy}>
              <FolderOpen className="h-4 w-4" />
              {t('report_pick_folder')}
            </button>
            <button type="button" onClick={() => zipInput.current?.click()} className={BTN_SECONDARY} disabled={!!busy}>
              <FileArchive className="h-4 w-4" />
              {t('report_pick_zip')}
            </button>
            <button type="button" onClick={() => filesInput.current?.click()} className={BTN_SECONDARY} disabled={!!busy}>
              <Files className="h-4 w-4" />
              {t('report_pick_files')}
            </button>
            {hasAny && (
              <button type="button" onClick={clear} className="text-xs text-muted underline-offset-2 hover:underline" disabled={!!busy}>
                {t('report_assets_clear')}
              </button>
            )}
            <input
              ref={folderInput}
              type="file"
              multiple
              className="sr-only"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="sr-only"
              onChange={(e) => {
                void pickZip(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <input
              ref={filesInput}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {hasAny && (
            <div className="mt-4 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
              <p className="mb-2 text-xs text-muted">
                {zipFile ? `${zipFile.name} · ${fmtSize(zipFile.size)}` : t('report_bundle_picked', { count: picked.length, size: fmtSize(totalBytes) })}
                {zipFile && zipEntries === null ? ` · ${t('report_bundle_reading')}` : ''}
              </p>
              <ul className="space-y-1">
                {plan.importJson
                  ? row(true, t('report_detected_import'), bundleBasename(plan.importJson.path))
                  : plan.sources.length > 1
                    ? row(true, t('report_detected_pages', { count: plan.sources.length }), plan.sources.slice(0, 4).map((s) => bundleBasename(s.file.path)).join('、'))
                    : row(plan.sources.length > 0, t('report_detected_chat'), plan.sources[0] ? `${bundleBasename(plan.sources[0].file.path)} · ${fmtSize(plan.sources[0].file.size)} · ${plan.sources[0].kind === 'welink_json' ? 'welink-cli JSON' : 'TXT'}` : undefined)}
                {!plan.importJson && row(!!plan.manifest, t('report_detected_manifest'), plan.manifest ? bundleBasename(plan.manifest.path) : undefined)}
                {row(plan.assets.length > 0, t('report_detected_assets', { images, files }))}
                {plan.names.length > 0 && row(true, t('report_detected_names', { count: plan.names.length }))}
                {plan.ignored.filter((i) => i.reason !== 'system').length > 0 &&
                  row(false, t('report_detected_skipped', { count: plan.ignored.filter((i) => i.reason !== 'system').length }), plan.ignored.filter((i) => i.reason !== 'system').slice(0, 5).map((i) => bundleBasename(i.file.path)).join('、'))}
              </ul>
              {!hasChat && (!zipFile || zipEntries !== null) && <p className="mt-2 text-xs text-danger">{t('report_bundle_no_chat')}</p>}
            </div>
          )}
        </div>
        <p className={HINT_CLS}>{t('report_bundle_hint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS} htmlFor="report-kind">
            {t('report_kind')}
          </label>
          <select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={`${SELECT_CLS} w-full`}>
            {(['daily', 'weekly', 'monthly', 'custom'] as Kind[]).map((k) => (
              <option key={k} value={k}>
                {t(`report_kind_${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="report-subject">
            {t('report_subject')}
          </label>
          <input id="report-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT_CLS} maxLength={80} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="report-from">
            {t('report_period_from')}
          </label>
          <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="report-to">
            {t('report_period_to')}
          </label>
          <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS} htmlFor="report-title">
            {t('report_title')}
          </label>
          <input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLS} maxLength={120} placeholder={t('report_title_placeholder')} />
          <p className={HINT_CLS}>{t('report_period_hint')}</p>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS} htmlFor="report-instructions">
          {t('report_instructions')}
        </label>
        <textarea
          id="report-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={t('report_instructions_placeholder')}
          className={TEXTAREA_CLS}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="report-ins-mode" checked={instructionMode === 'append'} onChange={() => setInstructionMode('append')} className="h-3.5 w-3.5" />
            {t('report_instructions_append')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="report-ins-mode" checked={instructionMode === 'override'} onChange={() => setInstructionMode('override')} className="h-3.5 w-3.5" />
            {t('report_instructions_override')}
          </label>
          <button type="button" onClick={() => setShowGuide((v) => !v)} className="text-xs text-muted underline-offset-2 hover:underline">
            {showGuide ? t('report_instructions_hide_guide') : t('report_instructions_show_guide')}
          </button>
        </div>
        <p className={HINT_CLS}>{t('report_instructions_hint')}</p>
        {showGuide && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">{DEFAULT_WRITING_GUIDE}</pre>}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        {busy && (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {busy}
          </span>
        )}
        <button type="button" onClick={() => void submit()} disabled={!ready} className={BTN_PRIMARY}>
          <Upload className="h-4 w-4" />
          {t('report_start')}
        </button>
      </div>
    </div>
  );
}
