'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { FileDropZone } from '@/app/skills/_components/FileDropZone';
import {
  type StagedFile,
  hasSkillMd,
  findSkillMd,
  buildZip,
  parseFrontmatterLite,
  MAX_PACKAGE_BYTES,
} from '@/app/skills/_components/staged';

export function VersionUploader({ slug, currentVersion }: { slug: string; currentVersion: string | null }) {
  const router = useRouter();
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [changelog, setChangelog] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onChange(next: StagedFile[]) {
    setStaged(next);
    const sm = findSkillMd(next);
    if (!sm) {
      setDetected(null);
      return;
    }
    const text = sm.file ? await sm.file.text() : sm.bytes ? new TextDecoder().decode(sm.bytes) : '';
    setDetected(parseFrontmatterLite(text).version ?? null);
  }

  function submit() {
    if (!hasSkillMd(staged)) {
      pushToast('error', '缺少 SKILL.md');
      return;
    }
    start(async () => {
      const zip = await buildZip(staged);
      if (zip.size > MAX_PACKAGE_BYTES) {
        pushToast('error', `打包后 ${(zip.size / 1024 / 1024).toFixed(1)}MB，超过 5MB 上限`);
        return;
      }
      const form = new FormData();
      form.set('file', zip);
      form.set('changelog', changelog);
      const res = await fetch(`/api/skills/${slug}/versions`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reasons: Record<string, string> = {
          version_not_increasing: `版本号必须大于当前 v${data.current}（你给的是 v${data.got}）`,
          version_exists: `版本 ${data.version} 已存在`,
          invalid_version: 'SKILL.md frontmatter 里的 version 不合法（需 x.y.z）',
          parse_failed: `解析失败：${data.reason ?? ''}`,
          too_large: '包太大（>5MB）',
        };
        pushToast('error', reasons[data.error] ?? data.error ?? '上传失败');
        return;
      }
      pushToast('success', `已发布新版本 v${data.version.version}`);
      setStaged([]);
      setChangelog('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {detected && (
        <div className="text-xs text-muted">
          检测到版本：<span className="font-mono text-accent-600">v{detected}</span>
        </div>
      )}
      <FileDropZone staged={staged} onChange={onChange} title="上传新版本" />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Changelog（可选）</label>
        <input
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder="这一版改了什么…"
          className="w-full rounded-lg border border-zinc-300 bg-[rgb(var(--surface))] px-3 py-2 text-sm outline-none transition focus:border-accent-500 dark:border-zinc-700"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending || !hasSkillMd(staged)}
          onClick={submit}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          发布新版本
        </button>
      </div>
    </div>
  );
}
