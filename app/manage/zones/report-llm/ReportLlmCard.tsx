'use client';

// 版块报告模型配置卡（/manage 全站中文）。和知识库的 AiSettingsCard 同一套交互：
// 沿用知识库 / 单独配置 → 四个字段 → 两个自建服务开关 → 保存 / 测试连接（显示直连还是经代理）。

import { useEffect, useRef, useState } from 'react';
import { FileBarChart2, Loader2, Plug } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface SettingState {
  useLibrary: boolean;
  llmProvider: string | null;
  llmBaseUrl: string | null;
  llmModel: string | null;
  hasApiKey: boolean;
  llmDisableThinking: boolean;
  llmJsonMode: boolean;
}

interface LibraryInfo {
  provider: string;
  model: string | null;
  baseUrl: string | null;
}

interface TestResult {
  ok: boolean;
  source?: 'reports' | 'library' | null;
  provider?: string;
  model?: string;
  reply?: string;
  jsonOk?: boolean;
  name?: string;
  message?: string;
  cause?: string | null;
  finishReason?: string | null;
  reasoningChars?: number;
  ms?: number;
  route?: { via: string; proxyUri: string | null; useProxy: boolean } | null;
}

const inputCls =
  'h-8 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900';

export function ReportLlmCard() {
  const [setting, setSetting] = useState<SettingState | null>(null);
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [useLibrary, setUseLibrary] = useState(true);
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('__keep__');
  const [disableThinking, setDisableThinking] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/zones/report-llm');
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data?.setting) return;
        setSetting(data.setting);
        setLibrary(data.library ?? null);
        setUseLibrary(Boolean(data.setting.useLibrary));
        setProvider(data.setting.llmProvider ?? 'openai');
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

  async function save() {
    if (savingRef.current) return;
    if (!useLibrary && (!baseUrl.trim() || !model.trim())) {
      pushToast('error', '单独配置时 Base URL 与模型都不能为空');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/zones/report-llm', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useLibrary,
          llmProvider: provider || null,
          llmBaseUrl: baseUrl.trim() || null,
          llmModel: model.trim() || null,
          llmApiKey: apiKey,
          llmDisableThinking: disableThinking,
          llmJsonMode: jsonMode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) throw new Error(data.reason ?? 'failed');
      pushToast('success', '报告模型配置已保存');
      setSetting((s) => (s ? { ...s, useLibrary, hasApiKey: apiKey === '__keep__' ? s.hasApiKey : Boolean(apiKey) } : s));
      if (apiKey && apiKey !== '__keep__') setApiKey('__keep__');
    } catch (e) {
      pushToast('error', e instanceof Error && e.message !== 'failed' ? e.message : '保存失败，请重试');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/zones/report-llm/test', { method: 'POST' });
      setTestResult(await res.json().catch(() => ({ ok: false, message: '响应解析失败' })));
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTesting(false);
    }
  }

  if (!setting) return null;

  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center gap-2">
        <FileBarChart2 className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />
        <h3 className="text-sm font-semibold">版块报告模型</h3>
        <span className="badge" style={{ background: setting.useLibrary ? '#f4f4f5' : '#dcfce7', color: setting.useLibrary ? '#52525b' : '#166534' }}>
          {setting.useLibrary ? '沿用知识库 AI' : '单独配置'}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        当前知识库 AI：
        {library ? `${library.provider} · ${library.model ?? '未配置模型'}${library.baseUrl ? ` · ${library.baseUrl}` : ''}` : '未配置（沿用时生成报告会失败）'}
        。网络出口与知识库一致：默认直连内网模型；只有服务端设置了 <code>LLM_USE_PROXY=true</code> 才按主机规则走代理（测试连接会显示实际路由）。
      </p>

      <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="radio" name="report-llm-mode" checked={useLibrary} onChange={() => setUseLibrary(true)} className="h-3.5 w-3.5" />
          沿用知识库 AI 的配置（/manage/library）
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="report-llm-mode" checked={!useLibrary} onChange={() => setUseLibrary(false)} className="h-3.5 w-3.5" />
          给报告单独配置
        </label>
      </div>

      <div className="mt-3 grid gap-2.5 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls} disabled={useLibrary}>
            <option value="openai">OpenAI 兼容（vLLM/SGLang 等）</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Base URL</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://10.x.x.x:8000/v1" className={inputCls} disabled={useLibrary} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">模型</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash / qwen3-32b" className={inputCls} disabled={useLibrary} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">API Key{setting.hasApiKey ? '（已保存）' : '（可选）'}</label>
          <input
            type="password"
            value={apiKey === '__keep__' ? '' : apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={setting.hasApiKey ? '不修改则留空' : '内部服务可留空'}
            className={inputCls}
            disabled={useLibrary}
          />
        </div>
      </div>

      <div className={`mt-3 space-y-1.5 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700 ${useLibrary ? 'opacity-50' : ''}`}>
        <p className="text-[11px] font-medium text-muted">
          自建推理服务（vLLM / SGLang）专用 —— 会在请求体里加非标准字段，<span className="text-danger">指向 api.openai.com 时会被 400 拒绝</span>。
        </p>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={disableThinking} onChange={(e) => setDisableThinking(e.target.checked)} className="h-3.5 w-3.5" disabled={useLibrary} />
          关闭思考（chat_template_kwargs.enable_thinking=false）
          <span className="text-muted">—— 推理模型把预算烧在 &lt;think&gt; 里就拿不到完整 JSON</span>
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} className="h-3.5 w-3.5" disabled={useLibrary} />
          强制 JSON 输出（response_format: json_object）
          <span className="text-muted">—— 报告流水线每一步都要 JSON，自建服务建议打开</span>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          保存配置
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={() => void test()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-[13px] font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          title="用当前已保存的配置真实调用一次模型（要求回 JSON），直接显示底层错误与网络路由"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          测试连接
        </button>
        <span className="text-[11px] text-muted">测试用的是已保存的配置——改完先保存再测。</span>
      </div>

      {testResult && (
        <div className={`mt-3 space-y-1 rounded-lg px-3 py-2 font-mono text-[11px] ${testResult.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}>
          <div>
            {testResult.ok
              ? `✓ ${testResult.source === 'reports' ? '单独配置' : '沿用知识库'} · ${testResult.provider} · ${testResult.model} · ${testResult.ms}ms · 回复「${testResult.reply}」` +
                (testResult.jsonOk ? ' · JSON ✓' : ' · JSON ✗（模型没按要求回 JSON，生成报告大概率会反复重试）') +
                (testResult.finishReason ? ` · finish=${testResult.finishReason}` : '') +
                (testResult.reasoningChars ? ` · 思考 ${testResult.reasoningChars} 字(已分离)` : '')
              : `✗ ${testResult.name ?? '失败'} · ${testResult.ms}ms${testResult.source ? ` · ${testResult.source === 'reports' ? '单独配置' : '沿用知识库'}` : ''}`}
            {testResult.route ? ` · ${testResult.route.via === 'proxy' ? `经代理 ${testResult.route.proxyUri}` : '直连'}` : ''}
          </div>
          {!testResult.ok && testResult.message && <div className="break-all">{testResult.message}</div>}
          {!testResult.ok && testResult.cause && <div className="break-all">↳ cause: {testResult.cause}</div>}
        </div>
      )}
    </div>
  );
}
