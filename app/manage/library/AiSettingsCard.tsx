'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface SettingState {
  llmProvider: string | null;
  llmBaseUrl: string | null;
  llmModel: string | null;
  hasApiKey: boolean;
}

interface EnvInfo {
  provider: string;
  model: string | null;
  baseUrl: string | null;
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
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
        ? { llmProvider: null, llmBaseUrl: null, llmModel: null, llmApiKey: null }
        : {
            llmProvider: provider || null,
            llmBaseUrl: baseUrl.trim() || null,
            llmModel: model.trim() || null,
            llmApiKey: apiKey,
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
        <Sparkles className="h-4 w-4 text-accent-500" />
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
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 text-[13px] font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
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
      </div>
    </div>
  );
}
