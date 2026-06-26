'use client';

import { useState } from 'react';
import { Loader2, FlaskConical, Wand2, Check, Send, Trash2, Eye, EyeOff, ChevronRight } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { DEFAULT_GUIDANCE_PROMPT } from '@/lib/comparison';
import { streamChat } from './streamChat';
import { ComparisonView, type ComparisonExampleView } from './ComparisonView';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export interface StudioInitialState {
  status: string | null; // 'draft' | 'published' | null
  bodyMd: string;
  example: ComparisonExampleView | null;
  guidancePrompt: string;
  model: string | null;
  stale: boolean;
}

export function ComparisonStudio({ slug, initial }: { slug: string; initial: StudioInitialState }) {
  const [status, setStatus] = useState<string | null>(initial.status);
  const [bodyMd, setBodyMd] = useState(initial.bodyMd);
  const [example, setExample] = useState<ComparisonExampleView | null>(initial.example);
  const [model, setModel] = useState<string | null>(initial.model);
  const [taskPrompt, setTaskPrompt] = useState(initial.example?.taskPrompt ?? '');
  const [guidance, setGuidance] = useState(initial.guidancePrompt || DEFAULT_GUIDANCE_PROMPT);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [followup, setFollowup] = useState('');
  const [baselinePending, setBaselinePending] = useState(false);
  const [chatPending, setChatPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showBaseline, setShowBaseline] = useState(Boolean(initial.example));

  async function runBaseline() {
    if (!taskPrompt.trim()) {
      pushToast('error', '请先填写样例任务');
      return;
    }
    setBaselinePending(true);
    try {
      const res = await fetch(`/api/skills/${slug}/comparison/baseline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast('error', data.reason ?? data.error ?? '实测失败');
        return;
      }
      setExample(data.example);
      setModel(data.model ?? null);
      setMessages([]);
      pushToast('success', '实测完成');
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '实测失败');
    } finally {
      setBaselinePending(false);
    }
  }

  // Generation only ever fires from an explicit button click (生成 / 微调 / 发送),
  // never from focus/typing — so the author is always in control of model calls.
  async function sendToWorkshop(history: Msg[]) {
    setChatPending(true);
    setMessages([...history, { role: 'assistant', content: '' }]);
    try {
      const result = await streamChat(
        `/api/skills/${slug}/comparison/workshop`,
        { example, messages: history }, // example may be null — workshop generates from the skill alone
        (delta) =>
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: next[next.length - 1].content + delta,
            };
            return next;
          }),
      );
      if (!result.ok) {
        pushToast('error', result.error ?? '生成失败');
        setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '生成失败');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatPending(false);
    }
  }

  function generate() {
    if (chatPending) return;
    sendToWorkshop([{ role: 'user', content: guidance.trim() || DEFAULT_GUIDANCE_PROMPT }]);
  }

  function sendFollowup() {
    const text = followup.trim();
    if (!text || chatPending) return;
    setFollowup('');
    sendToWorkshop([...messages, { role: 'user', content: text }]);
  }

  function adopt(content: string) {
    setBodyMd(content);
    pushToast('info', '已载入下方编辑器，可微调后发布');
  }

  async function save(nextStatus: 'draft' | 'published') {
    if (nextStatus === 'published' && !bodyMd.trim()) {
      pushToast('error', '发布前请先填写对比正文');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${slug}/comparison`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd, example, guidancePrompt: guidance, model, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast('error', data.reason ?? data.error ?? '保存失败');
        return;
      }
      setStatus(nextStatus);
      pushToast('success', nextStatus === 'published' ? '已发布，访客可见' : '已保存草稿');
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('确定删除这份对比？')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${slug}/comparison`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      setStatus(null);
      setBodyMd('');
      setExample(null);
      setMessages([]);
      pushToast('success', '已删除');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">对比工坊</span>
        <StatusPill status={status} />
        {initial.stale && status && (
          <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
            技能内容已更新，建议重新生成
          </span>
        )}
        {model && <span className="font-mono text-[11px] text-muted">模型 {model}</span>}
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-accent-600"
        >
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPreview ? '收起预览' : '预览访客视图'}
        </button>
      </div>

      {showPreview && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <ComparisonView bodyMd={bodyMd} example={example} />
        </div>
      )}

      {/* AI generate + refine chat (primary) */}
      <section className="surface space-y-3 rounded-2xl p-4">
        <div>
          <h3 className="text-sm font-semibold">用 AI 生成对比文案</h3>
          <p className="mt-1 text-xs text-muted">
            AI 会读取这个 skill 的完整内容，直接写出「装上 vs 不装」的结构化对比。
            {!example && '想更有说服力，可在下方「实测（可选）」跑一次真实 Before / After。'}
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">想让 AI 重点突出什么？（可选）</span>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value.slice(0, 8000))}
            rows={2}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
        </label>

        <button
          onClick={generate}
          disabled={chatPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {chatPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          AI 一键生成对比文案
        </button>

        {messages.length > 0 && (
          <div className="space-y-3 pt-1">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-accent-500 text-white'
                      : 'w-full bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    m.content ? (
                      <div className="space-y-2">
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{m.content}</pre>
                        <button
                          onClick={() => adopt(m.content)}
                          className="inline-flex items-center gap-1 rounded-md border border-accent-500/40 px-2 py-1 text-xs text-accent-700 transition hover:bg-accent-500/10 dark:text-accent-300"
                        >
                          <Check className="h-3 w-3" />
                          用作对比
                        </button>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 思考中…
                      </span>
                    )
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <textarea
                value={followup}
                onChange={(e) => setFollowup(e.target.value.slice(0, 8000))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendFollowup();
                  }
                }}
                rows={1}
                placeholder="继续微调，比如「Before/After 那段再具体些」"
                className="flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              />
              <button
                onClick={sendFollowup}
                disabled={chatPending || !followup.trim()}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 实测 — optional, collapsible */}
      <section className="surface overflow-hidden rounded-2xl">
        <button
          onClick={() => setShowBaseline((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium"
        >
          <ChevronRight className={`h-4 w-4 transition ${showBaseline ? 'rotate-90' : ''}`} />
          实测（可选）：真实跑一次「装上 / 不装」对照
          {example && (
            <span className="ml-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok">已实测</span>
          )}
          <span className="ml-auto text-xs font-normal text-muted">给对比加上真实 Before / After 证据</span>
        </button>
        {showBaseline && (
          <div className="space-y-2 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <textarea
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value.slice(0, 4000))}
              rows={3}
              placeholder="给一个能体现这个 skill 价值的任务，比如「帮我做一页 MoE 架构的技术汇报」"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted">{taskPrompt.length} / 4000</span>
              <button
                onClick={runBaseline}
                disabled={baselinePending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
              >
                {baselinePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                实测
              </button>
            </div>
            {example && (
              <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2">
                <RawOutput title="不装（baseline）" text={example.withoutOutput} />
                <RawOutput title="装上这个 Skill" text={example.withOutput} accent />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Edit + publish */}
      <section className="surface space-y-2 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">编辑并发布</h3>
        <textarea
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value.slice(0, 40000))}
          rows={12}
          placeholder="点上面的「用作对比」把某条回复载入这里，或直接手写 Markdown 对比正文。"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[13px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => save('published')}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            发布
          </button>
          <button
            onClick={() => save('draft')}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
          >
            保存草稿
          </button>
          {status && (
            <button
              onClick={remove}
              disabled={saving}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (status === 'published')
    return <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] text-ok">已发布</span>;
  if (status === 'draft')
    return <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">草稿</span>;
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-muted dark:bg-zinc-800">尚未创建</span>;
}

function RawOutput({ title, text, accent }: { title: string; text: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wider ${accent ? 'text-accent-600' : 'text-muted'}`}>
        {title}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
        {text || '（空）'}
      </pre>
    </div>
  );
}
