import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { hasFreeSpace } from '@/lib/uploads/disk-space';
import { newZoneMediaKey, saveZoneMediaStream, zoneMediaExtFor, zoneMediaPublicUrl } from '@/lib/zones/storage';
import { MAX_ZONE_FILE_BYTES } from '@/lib/zones/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const UPLOADS_PER_MINUTE = 20;

// POST /api/tools/chat-report/upload — 工具的资料包上传（登录即可；不经过任何版块）。
// 只收 `file` 一种 kind（整包 zip / 单个记录文件），存到和版块附件同一个媒体库（key 不可猜，
// 服务 /api/zones/media 只要登录）；分享到版块时这些 key 原样成为帖子附件。
// 头：content-type、x-filename（encodeURIComponent）。
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const gate = rateLimit(`tools:chat-report:upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('zone_rate_limited_upload'), resetAt: gate.resetAt },
      { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000))) } },
    );
  }
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }
  const displayName = filename.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  const max = MAX_ZONE_FILE_BYTES;
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return NextResponse.json({ error: 'file_too_large', reason: await apiReason('zone_file_too_large') }, { status: 413 });
  if (!(await hasFreeSpace(declared))) return NextResponse.json({ error: 'insufficient_storage' }, { status: 507 });
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newZoneMediaKey('file', zoneMediaExtFor('file', contentType, filename));
  let size = 0;
  try {
    size = await saveZoneMediaStream(key, req.body, max);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large', reason: await apiReason('zone_file_too_large') }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed', reason: await apiReason('zone_upload_failed') }, { status: 500 });
  }
  return NextResponse.json({ key, url: zoneMediaPublicUrl(key), size, kind: 'file', name: displayName });
}
