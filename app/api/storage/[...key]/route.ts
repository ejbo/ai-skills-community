import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join('/');
  try {
    const buf = await storage.get(key);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
        'cache-control': 'private, max-age=60',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
