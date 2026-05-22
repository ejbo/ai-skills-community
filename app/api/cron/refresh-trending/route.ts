import { NextResponse } from 'next/server';
import { refreshTrending } from '@/lib/trending';
import { env } from '@/lib/env';

/**
 * Refresh `trendingScore` for every published skill.
 *
 * Auth:
 * - Vercel: header `x-vercel-cron: 1` is set by the platform.
 * - Self-hosted (Ubuntu cron): pass `Authorization: Bearer <CRON_SECRET>` where
 *   CRON_SECRET matches an env variable, OR call from localhost (loopback).
 *
 * Schedule with system cron (every 10 minutes):
 *   "0,10,20,30,40,50 * * * *  curl -fsSL -H 'Authorization: Bearer SECRET'
 *                              http://localhost:3000/api/cron/refresh-trending > /dev/null"
 */
function isAuthorized(req: Request): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const cronSecret = process.env.CRON_SECRET ?? env.AUTH_SECRET;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${cronSecret}`) return true;
  const host = req.headers.get('host') ?? '';
  if (host.startsWith('localhost') || host.startsWith('127.')) return true;
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await refreshTrending();
  return NextResponse.json({ ok: true, ...result });
}

export const POST = GET;
