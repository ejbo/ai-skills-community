import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonCapped } from '@/lib/http/read-json-capped';
import { MAX_PINS, pinKey, sanitizePin } from '@/lib/profile/shared';
import {
  findDeadPins,
  isOwnPinnable,
  loadStoredPins,
  pruneProfilePins,
  setProfilePin,
} from '@/lib/profile/pins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `{kind, id, pinned}` is a few dozen bytes; the cap only has to stop a chunked flood. */
const MAX_BODY_BYTES = 8 * 1024;

// POST {kind, id, pinned} — pin one of MY items to the 概览 精选 band, or unpin it.
// POST {prune: true}      — 清理: drop every stored pin that no longer resolves.
//
// Pinning requires the item to be the caller's own AND to pass its public gate
// right now (a draft, a private doc or someone else's post can never be
// pinned). Unpinning is always allowed. A pin whose item has since died
// (deleted / private / archived) has no PinButton anywhere, so the server
// clears it: pinning into a full list prunes the dead ones first, and the
// owner's 概览 offers 清理 (lib/profile/pins.ts, "Writes").
// The pins themselves are re-gated per viewer on every render.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`profile:pins:${userId}`, 60, 60_000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000))) } },
    );
  }

  const parsed = await readJsonCapped(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.error === 'payload_too_large'
      ? NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
      : NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const body = parsed.value as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  if (body.prune === true) {
    const stored = await loadStoredPins(userId);
    const dead = await findDeadPins(userId, stored);
    const result = dead.size > 0 ? await pruneProfilePins(userId, dead) : { pins: stored, removed: 0 };
    return NextResponse.json(result);
  }

  if (typeof body.pinned !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const pin = sanitizePin(body);
  if (!pin) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  let dead = new Set<string>();
  if (body.pinned) {
    const [pinnable, stored] = await Promise.all([isOwnPinnable(userId, pin), loadStoredPins(userId)]);
    if (!pinnable) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // Only a full list needs the dead-pin check (≤ MAX_PINS small counts).
    const key = pinKey(pin);
    if (stored.length >= MAX_PINS && !stored.some((p) => pinKey(p) === key)) {
      dead = await findDeadPins(userId, stored);
    }
  }

  const result = await setProfilePin(userId, pin, body.pinned, dead);
  if (result.error === 'pins_full') {
    return NextResponse.json({ error: 'pins_full', pins: result.pins }, { status: 409 });
  }
  return NextResponse.json({ pins: result.pins });
}
