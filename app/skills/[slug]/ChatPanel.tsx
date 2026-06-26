'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTranslations } from 'next-intl';
import { clearChat, getState, sendMessage, subscribe, type ChatState } from './chatStore';

const EMPTY: ChatState = { messages: [], pending: false, error: null };

export function ChatPanel({ slug }: { slug: string }) {
  const t = useTranslations('detail.chat');
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Bind the external store to this slug. The session lives at module scope, so
  // its history + any in-flight generation survive client-side navigation and
  // reloads (see chatStore.ts).
  const subscribeSlug = useCallback((listener: () => void) => subscribe(slug, listener), [slug]);
  const getSnapshot = useCallback(() => getState(slug), [slug]);
  const { messages, pending, error } = useSyncExternalStore(subscribeSlug, getSnapshot, () => EMPTY);

  // Keep the transcript pinned to the latest message as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send(text: string) {
    if (!text.trim() || pending) return;
    setInput('');
    void sendMessage(slug, text, `/api/skills/${slug}/chat`);
  }

  const starters = [t('starter1'), t('starter2'), t('starter3')];

  return (
    <div className="surface flex h-[60vh] flex-col rounded-2xl">
      {messages.length > 0 && (
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <span className="text-xs text-muted">{t('saved_hint')}</span>
          <button
            onClick={() => clearChat(slug)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('clear')}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('empty')}</p>
            <div className="flex flex-wrap gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-accent-500 text-white'
                    : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                }`}
              >
                {msg.role === 'assistant' ? (
                  msg.content ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('thinking')}
                    </span>
                  )
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="border-t border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">{error}</div>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 8000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder={t('placeholder')}
          className="flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button
          onClick={() => send(input)}
          disabled={pending || !input.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('send')}
        </button>
      </div>
    </div>
  );
}
