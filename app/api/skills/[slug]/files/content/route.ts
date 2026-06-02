import { NextResponse } from 'next/server';
import { getSkillFileContent } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const path = new URL(req.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path_required' }, { status: 400 });
  const result = await getSkillFileContent(params.slug, path);
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: result.status });
  return NextResponse.json(result);
}
