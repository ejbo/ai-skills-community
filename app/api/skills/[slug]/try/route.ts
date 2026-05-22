import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';

const schema = z.object({
  prompt: z.string().min(1).max(2000),
  model: z.string().optional(),
});

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const HOUR_MS = 60 * 60 * 1000;

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<{ text: string; usage: { input: number; output: number } | null }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as AnthropicResponse;
  const text = json.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
  return {
    text,
    usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null,
  };
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'try_disabled', reason: '服务端未配置 ANTHROPIC_API_KEY' }, { status: 503 });
  }

  const session = await auth();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = session?.user ? `try:user:${session.user.id}` : `try:ip:${ip}`;
  const limit = session?.user ? 30 : 5;
  const gate = rateLimit(key, limit, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        reason: '请求过于频繁，请稍后再试',
        resetAt: gate.resetAt,
      },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: { currentVersion: true },
  });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const skillContent = skill.currentVersion.contentInline ?? skill.descriptionMd;
  const systemPrompt = `You have the following skill loaded. Use it whenever it applies to the user's prompt.\n\n--- SKILL ---\n${skillContent}\n--- END SKILL ---`;

  const model = parsed.data.model ?? DEFAULT_MODEL;
  try {
    const [withSkill, baseline] = await Promise.all([
      callAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        model,
        systemPrompt,
        userPrompt: parsed.data.prompt,
      }),
      callAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        model,
        userPrompt: parsed.data.prompt,
      }),
    ]);
    return NextResponse.json({
      model,
      with: withSkill,
      without: baseline,
      remaining: gate.remaining,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'upstream_failed', reason: message }, { status: 502 });
  }
}
