import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { env } from '@/lib/env';
import { bustLibraryLlmCache } from '@/lib/library/llm';

export const dynamic = 'force-dynamic';

// GET /api/admin/library/settings — current 知识库 AI override (+ env fallback
// info). The stored API key is masked; the UI sends '__keep__' to keep it.
export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const row = await prisma.librarySetting.findUnique({ where: { id: 'default' } }).catch(() => null);
  return NextResponse.json({
    setting: {
      llmProvider: row?.llmProvider ?? null,
      llmBaseUrl: row?.llmBaseUrl ?? null,
      llmModel: row?.llmModel ?? null,
      hasApiKey: Boolean(row?.llmApiKey),
    },
    envFallback: {
      provider: env.LLM_PROVIDER ?? 'anthropic',
      model: env.LLM_MODEL ?? null,
      baseUrl: env.LLM_BASE_URL ?? null,
    },
  });
}

const putSchema = z.object({
  llmProvider: z.enum(['anthropic', 'openai']).nullable(),
  llmBaseUrl: z.string().trim().max(500).nullable(),
  llmModel: z.string().trim().max(200).nullable(),
  // '__keep__' preserves the stored key; null/'' clears it.
  llmApiKey: z.string().max(500).nullable(),
});

// PUT /api/admin/library/settings — save the override (null everything to
// fall back to env).
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { llmProvider, llmBaseUrl, llmModel, llmApiKey } = parsed.data;
  const keepKey = llmApiKey === '__keep__';

  await prisma.librarySetting.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      llmProvider,
      llmBaseUrl: llmBaseUrl || null,
      llmModel: llmModel || null,
      llmApiKey: keepKey ? null : llmApiKey || null,
    },
    update: {
      llmProvider,
      llmBaseUrl: llmBaseUrl || null,
      llmModel: llmModel || null,
      ...(keepKey ? {} : { llmApiKey: llmApiKey || null }),
    },
  });
  bustLibraryLlmCache();

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_library_llm_setting',
    targetType: 'library_setting',
    targetId: 'default',
    details: { llmProvider, llmModel, llmBaseUrl, apiKeyChanged: !keepKey },
  });
  return NextResponse.json({ ok: true });
}
