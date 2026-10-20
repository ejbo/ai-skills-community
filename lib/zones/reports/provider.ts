// 版块报告用的模型（docs/contracts/reports.md §6）。
//
// 一行 ZoneReportSetting（id "default"）：useLibrary=true（默认）→ 沿用知识库 AI 的配置
// （LibrarySetting → env），这样已经配好内部模型的部署什么都不用动；useLibrary=false 且
// 填全了 baseUrl + model → 用这一行自己的（比如报告用更大的模型、知识库用小模型）。
// 出口与知识库同一条路：buildLlmOverride 用 llmFetch（默认直连；LLM_USE_PROXY=true 才按主机走代理）。
// 60 s 缓存；后台保存时 bustReportLlmCache()。

import { prisma } from '@/lib/db';
import type { LLMProvider } from '@/lib/llm';
import { buildLlmOverride, getLibraryProvider, type LlmSettingRow } from '@/lib/library/llm';

const CACHE_MS = 60_000;

export interface ReportSettingRow extends LlmSettingRow {
  useLibrary: boolean;
}

export interface ResolvedReportProvider {
  provider: LLMProvider;
  model: string | null;
  /** 'reports' = 本行自己的配置；'library' = 沿用知识库 AI（含其 env 回退）。 */
  source: 'reports' | 'library';
  baseUrl: string | null;
}

let cache: { value: ResolvedReportProvider; at: number } | null = null;

export function bustReportLlmCache(): void {
  cache = null;
}

export async function loadReportSetting(): Promise<ReportSettingRow | null> {
  try {
    return await prisma.zoneReportSetting.findUnique({
      where: { id: 'default' },
      select: { useLibrary: true, llmProvider: true, llmBaseUrl: true, llmApiKey: true, llmModel: true, llmDisableThinking: true, llmJsonMode: true },
    });
  } catch {
    return null; // 表还没迁移 → 当作沿用知识库
  }
}

export async function getReportProvider(): Promise<ResolvedReportProvider> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const setting = await loadReportSetting();
  let value: ResolvedReportProvider | null = null;
  if (setting && !setting.useLibrary) {
    const own = buildLlmOverride(setting);
    if (own) value = { provider: own, model: setting.llmModel?.trim() || null, source: 'reports', baseUrl: setting.llmBaseUrl?.trim() || null };
  }
  if (!value) {
    const lib = await getLibraryProvider();
    value = {
      provider: lib.provider,
      model: lib.model,
      source: 'library',
      baseUrl: (lib.provider as unknown as { baseUrl?: string }).baseUrl ?? null,
    };
  }
  cache = { value, at: Date.now() };
  return value;
}
