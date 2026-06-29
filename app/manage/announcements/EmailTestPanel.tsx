'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, CheckCircle2, XCircle } from 'lucide-react';

interface Status {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  ignoreTLS: boolean;
  from: string | null;
  hasAuth: boolean;
}

export function EmailTestPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/email-test')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d.status))
      .catch(() => {});
  }, []);

  async function send() {
    if (!to.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/email-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      setResult(res.ok ? { ok: true, msg: `已发送到 ${to}` } : { ok: false, msg: data.error ?? '发送失败' });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : '发送失败' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-semibold">邮件 (SMTP) 诊断</h3>
      </div>

      {status && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          <span className={status.configured ? 'text-ok' : 'text-danger'}>
            {status.configured ? '● 已配置' : '● 未配置 (需 SMTP_HOST + SMTP_FROM)'}
          </span>
          <span>host: {status.host ?? '—'}</span>
          <span>port: {status.port}</span>
          <span>secure: {String(status.secure)}</span>
          <span>ignoreTLS: {String(status.ignoreTLS)}</span>
          <span>auth: {status.hasAuth ? 'yes' : 'no'}</span>
          <span>from: {status.from ?? '—'}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="email"
          placeholder="收件邮箱，发送一封测试邮件"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button
          onClick={send}
          disabled={sending || !to.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          发送测试
        </button>
      </div>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
            result.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
          }`}
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span className="break-all font-mono">{result.msg}</span>
        </div>
      )}
    </div>
  );
}
