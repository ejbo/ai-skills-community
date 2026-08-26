'use client';

import { useEffect, useState } from 'react';
import { Loader2, Globe, CheckCircle2, XCircle } from 'lucide-react';

interface Status {
  useProxy: boolean;
  proxyUri: string | null;
  proxyConfigured: boolean;
  hasProxyAuth: boolean;
  bypass: string[];
  bypassIsDefault: boolean;
  proxyTlsInsecure: boolean;
  internalTlsInsecure: boolean;
  proxyCaFile: string | null;
  proxyCaLoaded: boolean;
  nodeExtraCaCerts: string | null;
  stdProxyEnv: { HTTPS_PROXY: string | null; HTTP_PROXY: string | null; NO_PROXY: string | null };
  configError: string | null;
  nodeVersion: string;
}

interface Route {
  label: string;
  url: string;
  via: string;
  proxyUri: string | null;
}

interface ProbeResult {
  ok: boolean;
  via?: string;
  proxyUri?: string | null;
  status?: number;
  contentType?: string | null;
  code?: string | null;
  name?: string;
  message?: string;
  cause?: string | null;
  dns?: string | null;
  dnsError?: string | null;
  timings?: { dns: number | null; total: number };
  error?: string;
}

/**
 * 网络出口 (Proxy) 诊断 — the network twin of the SMTP 诊断 panel. The whole point
 * is that it shows the RAW errno/cause and the chosen route, which the user-facing
 * toasts necessarily collapse.
 */
export function EgressTestPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [url, setUrl] = useState('https://mp.weixin.qq.com/');
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  useEffect(() => {
    fetch('/api/admin/egress-test')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setStatus(d.status);
        setRoutes(d.routes ?? []);
      })
      .catch(() => {});
  }, []);

  async function probe(target: string) {
    if (!target.trim()) return;
    setProbing(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/egress-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      setResult(await res.json().catch(() => ({ ok: false, message: '响应解析失败' })));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setProbing(false);
    }
  }

  const chip =
    'rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] transition hover:border-zinc-400 dark:hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700';

  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-semibold">网络出口 (Proxy) 诊断</h3>
      </div>

      {status && (
        <div className="space-y-1.5 font-mono text-[11px] text-muted">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={status.proxyConfigured ? 'text-ok' : 'text-danger'}>
              {status.proxyConfigured ? '● 代理已启用' : '● 直连 (未配置代理)'}
            </span>
            <span>proxy: {status.proxyUri ?? '—'}</span>
            <span>auth: {status.hasProxyAuth ? 'yes' : 'no'}</span>
            <span>tlsInsecure: {String(status.proxyTlsInsecure)}</span>
            <span>internalTlsInsecure: {String(status.internalTlsInsecure)}</span>
            <span>node: {status.nodeVersion}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              CA: {status.proxyCaLoaded ? status.proxyCaFile : (status.nodeExtraCaCerts ?? '系统根证书')}
            </span>
            <span>
              bypass{status.bypassIsDefault ? ' (默认)' : ''}: {status.bypass.join(' ')}
            </span>
          </div>
          {(status.stdProxyEnv.HTTPS_PROXY || status.stdProxyEnv.HTTP_PROXY) && !status.useProxy && (
            <div className="text-amber-600 dark:text-amber-500">
              检测到 HTTPS_PROXY/HTTP_PROXY，已被本应用识别；但 undici 本身不读它们，仅因为这里显式解析才生效
            </div>
          )}
          {status.configError && <div className="text-danger">⚠ {status.configError}</div>}
        </div>
      )}

      {routes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">快捷探测：</span>
          {routes.map((r) => (
            <button
              key={r.label}
              onClick={() => {
                setUrl(r.url);
                void probe(r.url);
              }}
              disabled={probing}
              className={chip}
              title={r.url}
            >
              {r.label}
              <span className={`ml-1 ${r.via === 'proxy' ? 'text-zinc-900 dark:text-zinc-50' : 'text-muted'}`}>
                {r.via === 'proxy' ? '走代理' : r.via === 'direct-insecure' ? '直连(免校验)' : '直连'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="url"
          placeholder="输入要探测的地址"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void probe(url)}
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button
          onClick={() => void probe(url)}
          disabled={probing || !url.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700"
        >
          {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
          探测
        </button>
      </div>

      {result && (
        <div
          className={`space-y-1 rounded-lg px-3 py-2 font-mono text-[11px] ${
            result.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {result.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {result.ok ? `HTTP ${result.status}` : (result.code ?? result.name ?? '失败')}
              {result.via ? ` · ${result.via === 'proxy' ? `经 ${result.proxyUri}` : result.via}` : ''}
              {result.timings ? ` · ${result.timings.total}ms` : ''}
            </span>
          </div>
          {result.message && <div className="break-all">{result.message}</div>}
          {result.cause && <div className="break-all">↳ cause: {result.cause}</div>}
          <div className="break-all opacity-80">
            dns: {result.dns ?? result.dnsError ?? '—'}
            {result.timings?.dns != null ? ` (${result.timings.dns}ms)` : ''}
            {result.contentType ? ` · ${result.contentType}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
