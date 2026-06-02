import { NextResponse } from 'next/server';
import { getSkillFileList } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const result = await getSkillFileList(params.slug);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ files: result.files });
}
