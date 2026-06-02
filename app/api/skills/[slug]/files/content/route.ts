import { NextResponse } from 'next/server';
import { loadAccessContext, accessDenial } from '@/lib/access';
import { getSkillFileContent } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path_required' }, { status: 400 });

  const { skill, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  if (skill.status !== 'published' && !privileged) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (skill.visibility !== 'public' && !decision.canContent) {
    const denial = accessDenial(decision, params.slug, url.origin);
    return NextResponse.json(denial.body, { status: denial.status });
  }

  const result = await getSkillFileContent(skill, path);
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: result.status });
  return NextResponse.json(result);
}
