'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AtSign, Eraser, Highlighter, Loader2, Send, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { pushToast } from '@/components/Toaster';

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

// API error codes → reader.* message keys (translated at render time).
const ERROR_KEYS: Record<string, string> = {
  no_content: 'err_no_content',
  rate_limited: 'err_rate_limited',
  llm_unconfigured: 'err_llm_unconfigured',
  llm_error: 'err_llm_error',
};

/**
 * 助手 tab body — AI chat over this doc with [cX-Y] citations. The conversation
 * is persisted per user per doc (loaded from /chat/history when the tab becomes
 * active; the chat route appends each exchange server-side). Rendered inside
 * ReaderRightPanel, which supplies the panel chrome + tab header.
 */
export function AssistantTab({
  active,
  docId,
  aiIndexState,
  questions,
  prefill,
  onCitationJump,
  selectionQuote,
  onAskAiSelection,
}: {
  active: boolean;
  docId: string;
  aiIndexState: string;
  questions: string[];
  prefill: { text: string; nonce: number } | null;
  onCitationJump: (citation: Citation) => void;
  /** Reader's current selection — 问 AI belongs HERE, not in the notes tab. */
  selectionQuote: string | null;
  onAskAiSelection: () => void;
}) {
  const t = useTranslations('reader');
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexState, setIndexState] = useState(aiIndexState);
  const [triggering, setTriggering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const errorLabel = (code: unknown): string | undefined =>
    typeof code === 'string' && ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : undefined;

  // Server refresh (e.g. after indexing finishes) is authoritative.
  useEffect(() => setIndexState(aiIndexState), [aiIndexState]);

  // Saved conversation.
  useEffect(() => {
    if (!active || messages !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/chat/history`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const rows = Array.isArray(data?.messages) ? data.messages : [];
        setMessages(
          rows.map((r: { role: string; content: string; citations?: unknown }) => ({
            role: r.role === 'assistant' ? 'assistant' : 'user',
            content: r.content,
            ...(r.citations ? { citations: toCitationMap(r.citations) } : {}),
          })),
        );
        window.setTimeout(
          () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
          60,
        );
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, docId, messages]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text.slice(0, 4000));
    if (active) window.setTimeout(() => inputRef.current?.focus(), 150);
  }, [prefill, active]);

  useEffect(() => {
    if (!active || indexState !== 'running') return;
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
  }, [active, indexState, docId, router]);

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
        setError(errorLabel(data?.error) ?? data?.reason ?? t('trigger_failed_retry'));
      }
    } catch {
      setError(t('network_error_later'));
    } finally {
      setTriggering(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm(t('confirm_clear_chat'))) return;
    try {
      const res = await fetch(`/api/library/docs/${docId}/chat/history`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      setMessages([]);
      pushToast('success', t('chat_cleared'));
    } catch {
      pushToast('error', t('clear_failed_retry'));
    }
  }

  async function send(text: string) {
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed || pending) return;
    setError(null);
    const history: ChatMsg[] = [...(messages ?? []), { role: 'user', content: trimmed }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);

    const scrollToEnd = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    const popEmptyAssistant = () =>
      setMessages((prev) =>
        prev && !prev[prev.length - 1]?.content ? prev.slice(0, -1) : prev,
      );

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
          setError(errorLabel(data?.error) ?? data?.reason ?? t('request_failed'));
        }
        popEmptyAssistant();
        return;
      }

      // First SSE frame carries {"citations": [...]}; the rest follow the
      // normalized data:{"delta"} / {"error"} / [DONE] protocol.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamError: string | undefined;
      let doneSeen = false;

      const append = (delta: string) => {
        setMessages((prev) => {
          if (!prev) return prev;
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
          if (!prev) return prev;
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
        setError(t('connection_lost_retry'));
        popEmptyAssistant();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unknown_error'));
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
  const list = messages ?? [];

  if (!ready) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-8 text-center">
        {indexState === 'running' ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
            <p className="text-sm font-medium">{t('ai_reading_doc')}</p>
          </>
        ) : (
          <>
            <Sparkles className="r-muted h-6 w-6" />
            <p className="text-sm font-medium">{t('ai_not_indexed')}</p>
            <p className="r-muted text-xs">{t('ai_not_indexed_desc')}</p>
            <button
              type="button"
              disabled={triggering}
              onClick={() => void triggerIndexing()}
              className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
            >
              {triggering && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('generate_ai_guide')}
            </button>
          </>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {ready && list.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void clearHistory()}
              title={t('clear_chat')}
              aria-label={t('clear_chat')}
              className="r-muted grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {messages === null ? (
          <div className="r-muted flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loading_chat')}
          </div>
        ) : list.length === 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="reader-assist-card">
                <Highlighter className="h-4 w-4 text-accent-500" />
                <p className="mt-1.5 text-sm font-semibold">{t('assist_card_highlight_title')}</p>
                <p className="r-muted mt-0.5 text-xs leading-relaxed">
                  {t('assist_card_highlight_desc')}
                </p>
              </div>
              <div className="reader-assist-card">
                <AtSign className="h-4 w-4 text-accent-500" />
                <p className="mt-1.5 text-sm font-semibold">{t('assist_card_context_title')}</p>
                <p className="r-muted mt-0.5 text-xs leading-relaxed">
                  {t('assist_card_context_desc')}
                </p>
              </div>
            </div>
            <p className="r-muted text-sm">{t('chat_intro')}</p>
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
          list.map((msg, i) => (
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
                      {t('retrieving_source')}
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

      {/* 引用选中段落 — the 问 AI entry point, next to the thing it feeds. */}
      {selectionQuote && (
        <div className="rborder flex items-start gap-2 border-t px-3 py-2">
          <p className="r-muted line-clamp-2 min-w-0 flex-1 border-l-2 border-accent-500/60 pl-2 text-xs leading-relaxed">
            {selectionQuote}
          </p>
          <button
            type="button"
            onClick={onAskAiSelection}
            className="rborder inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition hover:border-accent-500 hover:text-[var(--reader-accent)]"
          >
            <Sparkles className="h-3 w-3" />
            {t('ask_about_selection')}
          </button>
        </div>
      )}

      <div className="rborder flex items-end gap-2 border-t p-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder={t('chat_composer_placeholder')}
          className="rborder h-9 flex-1 resize-none rounded-lg border bg-transparent px-3 py-1.5 text-sm leading-6 focus:border-accent-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={pending || !input.trim()}
          aria-label={t('send')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-500 text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
