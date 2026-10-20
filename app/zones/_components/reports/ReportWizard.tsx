'use client';

// 版块报告 — 新建向导（docs/contracts/reports.md §2）。两种来源：
//   A. 聊天记录（WeLink 导出 TXT / welink-cli JSON）+ 可选的图片附件清单 CSV + 图片 / 文件
//   B. 导入 skill `chat-report` 产出的 report.json（+ 同一批图片 / 文件），不再调模型
// 文件先走 /attachments/upload（和帖子附件同一条路：图片 MIME 严格、其它一律 `file`），
// 再 POST /reports 建任务，随后跳到进度页轮询。

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, Images, Loader2, Upload } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { zoneHref } from '@/lib/zones/shared';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLS, LABEL_CLS, HINT_CLS, SELECT_CLS, CARD_CLS } from '../ui';

type Mode = 'chat' | 'import';
type Kind = 'daily' | 'weekly' | 'monthly' | 'custom';

interface Uploaded {
  key: string;
  name: string;
  kind: 'image' | 'file';
  mimeType: string;
  sizeBytes: number;
}

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp)$/i;

async function uploadOne(zoneSlug: string, file: File, kind: 'image' | 'file'): Promise<Uploaded> {
  const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/attachments/upload`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-upload-kind': kind,
      'x-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { key?: string; reason?: string; error?: string };
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? '2');
    await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
    return uploadOne(zoneSlug, file, kind);
  }
  if (!res.ok || !data.key) throw new Error(data.reason ?? data.error ?? `upload failed: ${file.name}`);
  return { key: data.key, name: file.name, kind, mimeType: file.type || '', sizeBytes: file.size };
}

export function ReportWizard({ zoneSlug, zoneName }: { zoneSlug: string; zoneName: string }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('chat');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('monthly');
  const [subject, setSubject] = useState(zoneName);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const assetInput = useRef<HTMLInputElement>(null);

  const ready = mode === 'chat' ? !!chatFile : !!importFile;

  async function submit() {
    if (busy || !ready) return;
    if (from && to && from > to) {
      pushToast('error', t('report_period_invalid'));
      return;
    }
    try {
      setBusy(t('report_uploading', { name: (mode === 'chat' ? chatFile : importFile)!.name }));
      const source = mode === 'chat' ? await uploadOne(zoneSlug, chatFile!, 'file') : null;
      const imported = mode === 'import' ? await uploadOne(zoneSlug, importFile!, 'file') : null;
      const manifest = mode === 'chat' && manifestFile ? await uploadOne(zoneSlug, manifestFile, 'file') : null;
      const uploaded: Uploaded[] = [];
      for (const f of assets) {
        setBusy(t('report_uploading', { name: f.name }));
        uploaded.push(await uploadOne(zoneSlug, f, IMAGE_RE.test(f.type) ? 'image' : 'file'));
      }
      setBusy(t('report_creating'));
      const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          subject: subject.trim(),
          periodStart: from || null,
          periodEnd: to || null,
          sourceKey: source?.key ?? null,
          sourceName: source?.name ?? null,
          manifestKey: manifest?.key ?? null,
          importKey: imported?.key ?? null,
          assets: uploaded,
        }),
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
      router.push(`${zoneHref(zoneSlug)}/reports/${data.id}`);
    } catch (e) {
      pushToast('error', (e as Error).message || t('report_create_failed'));
    } finally {
      setBusy(null);
    }
  }

  const fileRow = (label: string, hint: string, accept: string, file: File | null, set: (f: File | null) => void) => (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <label className={`${CARD_CLS} flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900`}>
        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : t('report_pick_file')}</span>
        <input type="file" accept={accept} className="sr-only" onChange={(e) => set(e.target.files?.[0] ?? null)} />
      </label>
      <p className={HINT_CLS}>{hint}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex gap-2">
        {(['chat', 'import'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={mode === m ? BTN_PRIMARY : BTN_SECONDARY}>
            {m === 'chat' ? t('report_mode_chat') : t('report_mode_import')}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{mode === 'chat' ? t('report_mode_chat_hint') : t('report_mode_import_hint')}</p>

      {mode === 'chat' ? (
        <>
          {fileRow(t('report_chat_file'), t('report_chat_file_hint'), '.txt,.json,text/plain,application/json', chatFile, setChatFile)}
          {fileRow(t('report_manifest_file'), t('report_manifest_file_hint'), '.csv,.json,text/csv', manifestFile, setManifestFile)}
        </>
      ) : (
        fileRow(t('report_import_file'), t('report_import_file_hint'), '.json,application/json', importFile, setImportFile)
      )}

      <div>
        <label className={LABEL_CLS}>{t('report_assets')}</label>
        <div className={`${CARD_CLS} px-4 py-3`}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => assetInput.current?.click()} className={BTN_SECONDARY}>
              <Images className="h-4 w-4" />
              {t('report_assets_pick')}
            </button>
            <input ref={assetInput} type="file" multiple className="sr-only" onChange={(e) => setAssets((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
            <span className="text-sm text-muted">{t('report_assets_count', { count: assets.length })}</span>
            {assets.length > 0 && (
              <button type="button" onClick={() => setAssets([])} className="text-xs text-muted underline-offset-2 hover:underline">
                {t('report_assets_clear')}
              </button>
            )}
          </div>
          {assets.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-xs text-muted">
              {assets.slice(0, 200).map((f, i) => (
                <li key={`${f.name}-${i}`} className="truncate font-mono">
                  {f.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className={HINT_CLS}>{t('report_assets_hint')}</p>
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

      <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        {busy && (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {busy}
          </span>
        )}
        <button type="button" onClick={submit} disabled={!ready || !!busy} className={BTN_PRIMARY}>
          <Upload className="h-4 w-4" />
          {t('report_start')}
        </button>
      </div>
    </div>
  );
}
