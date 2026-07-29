'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

export interface Citation {
  key: string;
  chapterIndex: number;
  charStart: number;
  snippet: string;
}

type CitationMap = Record<string, Citation>;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationMap;
}

const CITATION_RE = /\[c(\d+)-(\d+)\]/g;

function toCitationMap(arr: unknown): CitationMap {
  const map: CitationMap = {};
  if (Array.isArray(arr)) {
    for (const c of arr as Citation[]) {
      if (c && typeof c.key === 'string') map[c.key] = c;
    }
  }
  return map;
}

/** [cX-Y] markers → numbered markdown links (#cite-cX-Y) rendered as chips by reader.css. */
function transformCitations(content: string): string {
  const order = new Map<string, number>();
  return content.replace(CITATION_RE, (_, ch: string, ord: string) => {
    const key = `c${ch}-${ord}`;
    if (!order.has(key)) order.set(key, order.size + 1);
    return `[${order.get(key)}](#cite-${key})`;
  });
}

const ERROR_LABELS: Record<string, string> = {
  no_content: '该文档没有可分析的文本',
  rate_limited: '提问太频繁了，稍后再试',
  llm_unconfigured: 'AI 服务未配置',
  llm_error: 'AI 服务暂时不可用',
};

/**
 * 问问这篇文档 — SSE chat over the doc's cached retrieval index. Always mounted
 * (translated off-screen when closed) so messages survive chapter navigation.
 */
export function ReaderChatPanel({
  open,
  onClose,
  docId,
  aiIndexState,
  questions,
  prefill,
  onCitationJump,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  aiIndexState: string;
  questions: string[];
  prefill: { text: string; nonce: number } | null;
  onCitationJump: (citation: Citation) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexState, setIndexState] = useState(aiIndexState);
  const [triggering, setTriggering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Server refresh (e.g. after indexing finishes) is authoritative.
  useEffect(() => setIndexState(aiIndexState), [aiIndexState]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text.slice(0, 4000));
    if (open) window.setTimeout(() => inputRef.current?.focus(), 250);
  }, [prefill, open]);

  useEffect(() => {
    if (!open || indexState !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}`);
        const data = await res.json().catch(() => null);
        const state = data?.aiIndexState;
        if (typeof state === 'string' && state !== 'running') {
          setIndexState(state);
          if (state === 'ready') router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, indexState, docId, router]);

  async function triggerIndexing() {
    if (triggering) return;
    setTriggering(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/docs/${docId}/index`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok || data?.error === 'already_running') {
        setIndexState('running');
      } else {
        setError(ERROR_LABELS[data?.error as string] ?? data?.reason ?? '触发失败，稍后再试');
      }
    } catch {
      setError('网络错误，稍后再试');
    } finally {
      setTriggering(false);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed || pending) return;
    setError(null);
    const history: ChatMsg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);

    const scrollToEnd = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    const popEmptyAssistant = () =>
      setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));

    try {
      const res = await fetch(`/api/library/docs/${docId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-24).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (data?.error === 'not_indexed') {
          setIndexState('none');
        } else {
          setError(ERROR_LABELS[data?.error as string] ?? data?.reason ?? '请求失败');
        }
        popEmptyAssistant();
        return;
      }

      // Citation source map arrives as the first SSE frame ({"citations": [...]}),
      // ahead of the deltas; the remaining frames follow the normalized protocol
      // data:{"delta"} / {"error"} / [DONE] (as in streamChat).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamError: string | undefined;
      let doneSeen = false;

      const append = (delta: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
        scrollToEnd();
      };

      const attachCitations = (arr: unknown) => {
        const citations = toCitationMap(arr);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, citations };
          return next;
        });
      };

      const handle = (chunk: string): boolean => {
        for (const line of chunk.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          if (m[1] === '[DONE]') return true;
          try {
            const obj = JSON.parse(m[1]);
            if (typeof obj.delta === 'string') append(obj.delta);
            else if (typeof obj.error === 'string') streamError = obj.error;
            else if (obj.citations !== undefined) attachCitations(obj.citations);
          } catch {
            /* keep-alive / partial line */
          }
        }
        return false;
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const chunk of chunks) {
          if (handle(chunk)) {
            doneSeen = true;
            break;
          }
        }
        if (doneSeen) break;
      }
      if (!doneSeen) {
        buf += decoder.decode();
        if (buf.length > 0 && handle(buf)) doneSeen = true;
      }

      if (streamError) {
        setError(streamError);
        popEmptyAssistant();
      } else if (!doneSeen) {
        setError('连接中断，请重试');
        popEmptyAssistant();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
      popEmptyAssistant();
    } finally {
      setPending(false);
    }
  }

  function handleCiteClick(e: React.MouseEvent, citations: CitationMap | undefined) {
    const target = (e.target as HTMLElement).closest('a[href*="#cite-"]');
    if (!target) return;
    e.preventDefault();
    const href = target.getAttribute('href') ?? '';
    const key = href.slice(href.indexOf('#cite-') + '#cite-'.length);
    const citation = citations?.[key];
    if (citation) onCitationJump(citation);
  }

  const ready = indexState === 'ready';

  return (
    <div
      aria-hidden={!open}
      className={`reader-panel rborder absolute inset-x-0 bottom-0 z-40 flex h-[72vh] flex-col rounded-t-2xl border-t shadow-2xl transition-transform duration-300 ease-snap md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[400px] md:rounded-none md:border-l md:border-t-0 ${
        open
          ? 'translate-x-0 translate-y-0'
          : 'pointer-events-none translate-y-full md:translate-x-full md:translate-y-0'
      }`}
    >
      <div className="rborder flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent-500" />
          问问这篇文档
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="r-muted grid h-7 w-7 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!ready ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          {indexState === 'running' ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
              <p className="text-sm font-medium">AI 正在阅读本文档…</p>
              <p className="r-muted text-xs">只需一次，之后所有人共享。</p>
            </>
          ) : (
            <>
              <Sparkles className="r-muted h-6 w-6" />
              <p className="text-sm font-medium">AI 还没读过这篇文档</p>
              <p className="r-muted text-xs">生成导读与检索索引后即可提问，所有人共享一次生成结果。</p>
              <button
                type="button"
                disabled={triggering}
                onClick={triggerIndexing}
                className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
              >
                {triggering && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                生成 AI 导读
              </button>
            </>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="r-muted text-sm">
                  基于全文检索回答，答案会附上原文出处，点击角标即可跳转。
                </p>
                {questions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {questions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => {
                          setInput(q.slice(0, 4000));
                          inputRef.current?.focus();
                        }}
                        className="rborder rounded-full border px-3 py-1 text-left text-xs transition hover:border-accent-500 hover:text-[var(--reader-accent)]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-accent-500 text-white'
                        : 'rborder border bg-[var(--reader-hover)]'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      msg.content ? (
                        <div className="reader-chat-md" onClick={(e) => handleCiteClick(e, msg.citations)}>
                          <MarkdownRenderer compact content={transformCitations(msg.content)} />
                        </div>
                      ) : (
                        <span className="r-muted flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在检索原文…
                        </span>
                      )
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {error && (
            <div className="border-t border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">{error}</div>
          )}

          <div className="rborder flex items-end gap-2 border-t p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 4000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="问点关于这篇文档的问题…"
              className="rborder h-9 flex-1 resize-none rounded-lg border bg-transparent px-3 py-1.5 text-sm leading-6 focus:border-accent-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={pending || !input.trim()}
              aria-label="发送"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-500 text-white transition hover:bg-accent-600 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
