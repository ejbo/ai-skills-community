'use client';

import { useState } from 'react';
import { Loader2, Send, Sparkles, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { pushToast } from '@/components/Toaster';

interface TryResult {
  model: string;
  with: { text: string; usage: { input: number; output: number } | null };
  without: { text: string; usage: { input: number; output: number } | null };
  remaining?: number;
}

export function TryItTab({ slug }: { slug: string }) {
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!prompt.trim()) {
      pushToast('error', '请输入一个 prompt');
      return;
    }
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${slug}/try`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.reason ?? data.error ?? '失败');
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface space-y-2 rounded-2xl p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
            rows={4}
            maxLength={2000}
            placeholder="试试问点什么 — 比如「帮我把这段文字简明扼要地总结成 3 个要点」"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">{prompt.length} / 2000</span>
          <button
            onClick={run}
            disabled={pending}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            并排对比运行
          </button>
        </div>
      </div>

      {error && (
        <div className="surface rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {(pending || result) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ResponseColumn
            title="装上这个 Skill"
            icon={<Sparkles className="h-3.5 w-3.5 text-accent-600" />}
            pending={pending}
            text={result?.with.text}
            usage={result?.with.usage}
          />
          <ResponseColumn
            title="不装（baseline）"
            icon={<Zap className="h-3.5 w-3.5 text-muted" />}
            pending={pending}
            text={result?.without.text}
            usage={result?.without.usage}
          />
        </div>
      )}

      <p className="text-[11px] text-muted">
        服务端会并行调用 Claude API 两次。匿名用户每小时 5 次、登录用户 30 次。
        {result?.remaining !== undefined && (
          <span className="ml-1">本小时还剩 {result.remaining} 次。</span>
        )}
      </p>
    </div>
  );
}

function ResponseColumn({
  title,
  icon,
  pending,
  text,
  usage,
}: {
  title: string;
  icon: React.ReactNode;
  pending: boolean;
  text?: string;
  usage?: { input: number; output: number } | null;
}) {
  return (
    <div className="surface flex flex-col rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        {icon}
        {title}
      </div>
      {pending && !text ? (
        <div className="space-y-2">
          <div className="shimmer h-3 w-3/4 rounded" />
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-5/6 rounded" />
          <div className="shimmer h-3 w-2/3 rounded" />
        </div>
      ) : text ? (
        <>
          <div className="prose prose-zinc max-w-none text-sm leading-relaxed dark:prose-invert">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
          {usage && (
            <div className="mt-3 border-t border-zinc-100 pt-2 font-mono text-[10px] tabular-nums text-muted dark:border-zinc-800">
              输入 {usage.input} · 输出 {usage.output}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-muted">等待返回…</div>
      )}
    </div>
  );
}
