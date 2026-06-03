import { NextResponse } from 'next/server';
import { handleVideoBlobUpload } from '@/lib/video/storage';

// POST /api/videos/blob-upload (admin via token) — the @vercel/blob/client
// direct-upload handshake. Admin enforcement lives in onBeforeGenerateToken
// inside handleVideoBlobUpload (it throws for non-admin sessions).
export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json(await handleVideoBlobUpload(req, body));
}
