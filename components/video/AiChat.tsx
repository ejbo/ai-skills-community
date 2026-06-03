'use client';

import { useRef, useState } from 'react';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTranslations } from 'next-intl';
import { streamChat } from '@/app/skills/[slug]/streamChat';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function AiChat({ slug }: { slug: string }) {
  const t = useTranslations('video');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    const history: Msg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);

    try {
      const result = await streamChat(`/api/videos/${slug}/chat`, { messages: history }, (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: next[next.length - 1].content + delta,
          };
          return next;
        });
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
      if (!result.ok) {
        setError(result.error ?? '请求失败');
        setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  const starters = [t('ai.starter1'), t('ai.starter2'), t('ai.starter3')];

  return (
    <div className="surface flex h-[60vh] flex-col rounded-2xl">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
        <MessageCircleQuestion className="h-4 w-4 text-accent-600" />
        {t('ai.chat_title')}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('ai.chat_empty')}</p>
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
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('ai.thinking')}
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
          placeholder={t('ai.chat_placeholder')}
          className="flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button
          onClick={() => send(input)}
          disabled={pending || !input.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('ai.send')}
        </button>
      </div>
    </div>
  );
}
