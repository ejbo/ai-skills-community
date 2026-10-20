import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { getLibraryProvider } from '@/lib/library/llm';
import { bustReportLlmCache } from '@/lib/zones/reports/provider';
import { auditIp } from '../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// 版块报告的模型（docs/contracts/reports.md §6）— site `zones` permission.
//   GET /api/admin/zones/report-llm → { setting, library }   （API key 只给 hasApiKey）
//   PUT /api/admin/zones/report-llm { useLibrary, llmProvider, llmBaseUrl, llmModel, llmApiKey('__keep__' 保留), llmDisableThinking, llmJsonMode }
// 与 /api/admin/library/settings 同一套约定；useLibrary=true 时其余字段只是保存着备用。

export async function GET() {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const row = await prisma.zoneReportSetting.findUnique({ where: { id: 'default' } }).catch(() => null);
  let library: { provider: string; model: string | null; baseUrl: string | null } | null = null;
  try {
    const lib = await getLibraryProvider();
    library = { provider: lib.provider.id, model: lib.model ?? lib.provider.model ?? null, baseUrl: (lib.provider as unknown as { baseUrl?: string }).baseUrl ?? null };
  } catch {
    library = null; // 知识库也没配：沿用时报告会失败，页面上提示
  }
  return NextResponse.json({
    setting: {
      useLibrary: row?.useLibrary ?? true,
      llmProvider: row?.llmProvider ?? null,
      llmBaseUrl: row?.llmBaseUrl ?? null,
      llmModel: row?.llmModel ?? null,
      hasApiKey: Boolean(row?.llmApiKey),
      llmDisableThinking: row?.llmDisableThinking ?? false,
      llmJsonMode: row?.llmJsonMode ?? false,
    },
    library,
  });
}

const putSchema = z.object({
  useLibrary: z.boolean(),
  llmProvider: z.enum(['anthropic', 'openai']).nullable(),
  llmBaseUrl: z.string().trim().max(500).nullable(),
  llmModel: z.string().trim().max(200).nullable(),
  llmApiKey: z.string().max(500).nullable(),
  llmDisableThinking: z.boolean().optional(),
  llmJsonMode: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { useLibrary, llmProvider, llmBaseUrl, llmModel, llmApiKey, llmDisableThinking, llmJsonMode } = parsed.data;
  if (!useLibrary && (!llmBaseUrl || !llmModel)) {
    return NextResponse.json({ error: 'invalid_input', reason: '单独配置时 Base URL 与模型都不能为空' }, { status: 400 });
  }
  const keepKey = llmApiKey === '__keep__';
  const common = {
    useLibrary,
    llmProvider,
    llmBaseUrl: llmBaseUrl || null,
    llmModel: llmModel || null,
    llmDisableThinking: llmDisableThinking ?? false,
    llmJsonMode: llmJsonMode ?? false,
  };
  await prisma.zoneReportSetting.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...common, llmApiKey: keepKey ? null : llmApiKey || null },
    update: { ...common, ...(keepKey ? {} : { llmApiKey: llmApiKey || null }) },
  });
  bustReportLlmCache();
  await logAdmin({
    adminUserId: gate.session.user.id,
    action: 'update_zone_report_llm_setting',
    targetType: 'zone_report_setting',
    targetId: 'default',
    details: { useLibrary, llmProvider, llmModel, llmBaseUrl, apiKeyChanged: !keepKey },
    ip: auditIp(req),
  });
  return NextResponse.json({ ok: true });
}
