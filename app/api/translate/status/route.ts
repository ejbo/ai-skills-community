import { NextResponse } from 'next/server';
import { translationStatus } from '@/lib/translate/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/translate/status — is there an engine? The root layout normally seeds
// this into <TranslatePrefsProvider/>; the route is the fallback for a page that
// rendered without it, and what ops curl to check the slot. 60 s cached upstream,
// never throws: an unconfigured box answers `available:false` and the 翻译 link is
// simply not rendered anywhere (a capability flag, not a dead button).
export async function GET() {
  return NextResponse.json(await translationStatus(), { headers: { 'cache-control': 'private, max-age=60' } });
}
