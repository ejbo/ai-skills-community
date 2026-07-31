import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lookup } from 'node:dns/promises';
import { request as undiciRequest } from 'undici';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { describeEgress, egressFor } from '@/lib/net/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ url: z.string().trim().url() });

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Outbound-egress diagnostics for the intranet deploy — the network twin of the
 * SMTP 诊断 in /manage/announcements. Deliberately RAW: it reports the real
 * errno/cause and which route the request took, because everything downstream
 * (知识库 toast, LLM error) collapses those into "网络不通".
 */

// GET — the resolved egress config (no secrets) + where each known endpoint routes.
export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const targets: { label: string; url: string }[] = [
    { label: '公网', url: 'https://mp.weixin.qq.com/' },
    { label: '内网', url: 'https://w3.huawei.com/' },
  ];
  if (env.LLM_BASE_URL) targets.push({ label: 'LLM', url: env.LLM_BASE_URL });
  if (env.SSO_ACCESS_TOKEN_URL) targets.push({ label: 'SSO', url: env.SSO_ACCESS_TOKEN_URL });

  return NextResponse.json({
    status: describeEgress(),
    routes: targets.map((t) => {
      const eg = egressFor(t.url);
      return { ...t, via: eg.via, proxyUri: eg.proxyUri };
    }),
  });
}

interface Timings {
  dns: number | null;
  total: number;
}

// POST — actually probe a URL and return the underlying failure verbatim.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const url = parsed.data.url;
  const eg = egressFor(url);
  const started = Date.now();
  const timings: Timings = { dns: null, total: 0 };

  // Resolve locally too — a box with no public resolver is a distinct failure
  // from one that resolves fine but has no route, and the two look identical
  // once undici has wrapped them.
  let dnsResult: string | null = null;
  let dnsError: string | null = null;
  try {
    const t0 = Date.now();
    const addrs = await lookup(new URL(url).hostname, { all: true });
    timings.dns = Date.now() - t0;
    dnsResult = addrs.map((a) => a.address).join(', ');
  } catch (e) {
    timings.dns = Date.now() - started;
    dnsError = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
  }

  try {
    const res = await undiciRequest(url, {
      method: 'GET',
      headers: { 'user-agent': 'AI-Community-EgressProbe/1.0', accept: '*/*' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ...(eg.dispatcher ? { dispatcher: eg.dispatcher } : {}),
    });
    const contentType = res.headers['content-type'];
    void res.body.dump().catch(() => undefined);
    timings.total = Date.now() - started;
    return NextResponse.json({
      ok: true,
      via: eg.via,
      proxyUri: eg.proxyUri,
      status: res.statusCode,
      contentType: Array.isArray(contentType) ? contentType[0] : (contentType ?? null),
      dns: dnsResult,
      dnsError,
      timings,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: unknown };
    const cause = err.cause instanceof Error ? (err.cause as NodeJS.ErrnoException) : undefined;
    timings.total = Date.now() - started;
    return NextResponse.json(
      {
        ok: false,
        via: eg.via,
        proxyUri: eg.proxyUri,
        name: err.name,
        code: err.code ?? cause?.code ?? null,
        message: err.message,
        cause: cause?.message ?? null,
        dns: dnsResult,
        dnsError,
        timings,
      },
      { status: 502 },
    );
  }
}
