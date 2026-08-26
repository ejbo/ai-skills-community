'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Plug, Sparkles } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface SettingState {
  llmProvider: string | null;
  llmBaseUrl: string | null;
  llmModel: string | null;
  hasApiKey: boolean;
  llmDisableThinking: boolean;
  llmJsonMode: boolean;
}

interface EnvInfo {
  provider: string;
  model: string | null;
  baseUrl: string | null;
}

interface TestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  reply?: string;
  name?: string;
  message?: string;
  cause?: string | null;
  finishReason?: string | null;
  reasoningChars?: number;
  ms?: number;
  route?: { via: string; proxyUri: string | null; useProxy: boolean } | null;
}

const inputCls =
  'h-8 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-900';

/** 知识库 AI 模型配置 — admin override of the env LLM for indexing/chat. */
export function AiSettingsCard() {
  const [setting, setSetting] = useState<SettingState | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [provider, setProvider] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('__keep__');
  const [disableThinking, setDisableThinking] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const savingRef = useRef(false);

  /** Real one-shot completion through the live provider — raw error, no toast. */
  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/library/llm-test', { method: 'POST' });
      setTestResult(await res.json().catch(() => ({ ok: false, message: '响应解析失败' })));
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/library/settings');
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data?.setting) return;
        setSetting(data.setting);
        setEnv(data.envFallback ?? null);
        setProvider(data.setting.llmProvider ?? '');
        setBaseUrl(data.setting.llmBaseUrl ?? '');
        setModel(data.setting.llmModel ?? '');
        setApiKey(data.setting.hasApiKey ? '__keep__' : '');
        setDisableThinking(Boolean(data.setting.llmDisableThinking));
        setJsonMode(Boolean(data.setting.llmJsonMode));
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(clear = false) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const body = clear
        ? {
            llmProvider: null,
            llmBaseUrl: null,
            llmModel: null,
            llmApiKey: null,
            llmDisableThinking: false,
            llmJsonMode: false,
          }
        : {
            llmProvider: provider || null,
            llmBaseUrl: baseUrl.trim() || null,
            llmModel: model.trim() || null,
            llmApiKey: apiKey,
            llmDisableThinking: disableThinking,
            llmJsonMode: jsonMode,
          };
      const res = await fetch('/api/admin/library/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      pushToast('success', clear ? '已恢复为服务端环境配置' : 'AI 配置已保存');
      if (clear) {
        setProvider('');
        setBaseUrl('');
        setModel('');
        setApiKey('');
        setDisableThinking(false);
        setJsonMode(false);
        setSetting((s) => (s ? { ...s, hasApiKey: false } : s));
      }
    } catch {
      pushToast('error', '保存失败，请重试');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!setting) return null;

  const overrideActive = Boolean(setting.llmBaseUrl && setting.llmModel);

  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />
        <h3 className="text-sm font-semibold">知识库 AI 模型</h3>
        <span className="badge" style={{ background: overrideActive ? '#dcfce7' : '#f4f4f5', color: overrideActive ? '#166534' : '#52525b' }}>
          {overrideActive ? '使用自定义配置' : '使用环境配置'}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        用于章节摘要、AI 导读与文档问答。留空则回退到服务端环境变量
        {env ? `（${env.provider} · ${env.model ?? '未配置模型'}）` : ''}。
      </p>
      <div className="mt-3 grid gap-2.5 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
            <option value="">（跟随环境）</option>
            <option value="openai">OpenAI 兼容（vLLM/SGLang 等）</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://10.x.x.x:8000/v1"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">模型</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="qwen3-32b / claude-…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">
            API Key{setting.hasApiKey ? '（已保存）' : '（可选）'}
          </label>
          <input
            type="password"
            value={apiKey === '__keep__' ? '' : apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={setting.hasApiKey ? '不修改则留空' : '内部服务可留空'}
            className={inputCls}
          />
        </div>
      </div>
      <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
        <p className="text-[11px] font-medium text-muted">
          自建推理服务（vLLM / SGLang）专用 —— 这两个开关会在请求体里加非标准字段，
          <span className="text-danger">指向 api.openai.com 时会被 400 拒绝</span>，Anthropic 分支不受影响。
        </p>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={disableThinking}
            onChange={(e) => setDisableThinking(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          关闭思考（chat_template_kwargs.enable_thinking=false）
          <span className="text-muted">
            —— 推理模型会先输出 &lt;think&gt; 思考过程，吃光预算就拿不到 JSON；关掉它是治本方案
          </span>
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={jsonMode}
            onChange={(e) => setJsonMode(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          强制 JSON 输出（response_format: json_object）
          <span className="text-muted">—— 仅对需要 JSON 的调用生效</span>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 text-[13px] font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          保存配置
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(true)}
          className="h-8 rounded-lg border border-zinc-200 px-3.5 text-[13px] font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          恢复环境配置
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={() => void test()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-[13px] font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          title="用当前配置真实调用一次模型，直接显示底层错误"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          测试连接
        </button>
      </div>

      {testResult && (
        <div
          className={`mt-3 space-y-1 rounded-lg px-3 py-2 font-mono text-[11px] ${
            testResult.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
          }`}
        >
          <div>
            {testResult.ok
              ? `✓ ${testResult.provider} · ${testResult.model} · ${testResult.ms}ms · 回复「${testResult.reply}」` +
                (testResult.finishReason ? ` · finish=${testResult.finishReason}` : '') +
                // >0 ⇒ 服务端配了 --reasoning-parser，思考不会混进正文
                (testResult.reasoningChars ? ` · 思考 ${testResult.reasoningChars} 字(已分离)` : '')
              : `✗ ${testResult.name ?? '失败'} · ${testResult.ms}ms`}
            {testResult.route
              ? ` · ${testResult.route.via === 'proxy' ? `经代理 ${testResult.route.proxyUri}` : '直连'}`
              : ''}
          </div>
          {!testResult.ok && testResult.message && (
            <div className="break-all">{testResult.message}</div>
          )}
          {!testResult.ok && testResult.cause && (
            <div className="break-all">↳ cause: {testResult.cause}</div>
          )}
        </div>
      )}
    </div>
  );
}
