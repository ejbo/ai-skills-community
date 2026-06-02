import { NextResponse } from 'next/server';
import { loadAccessContext, accessDenial } from '@/lib/access';
import { getSkillFileList } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
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

  const result = await getSkillFileList(skill);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ files: result.files });
}
