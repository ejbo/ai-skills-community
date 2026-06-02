import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { loadAccessContext, accessDenial } from '@/lib/access';

/**
 * Download metadata / locator. Access is enforced here so the CLI gets an early,
 * actionable 401/403 (run `skills login` / apply for access). The actual bytes —
 * and the attributed Download record — are served by the gated /raw endpoint, so
 * this route intentionally does NOT log a download (avoids double counting).
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const versionArg = url.searchParams.get('version');

  const { skill, decision } = await loadAccessContext(params.slug, req);
  if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!decision.canContent) {
    const denial = accessDenial(decision, params.slug, url.origin);
    return NextResponse.json(denial.body, { status: denial.status });
  }

  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  const version = versionArg
    ? await prisma.skillVersion.findUnique({
        where: { skillId_version: { skillId: skill.id, version: versionArg } },
      })
    : skill.currentVersion;
  if (!version || (version.status !== 'published' && !privileged)) {
    return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
  }

  return NextResponse.json({
    version: version.version,
    // Always point at the gated byte stream (never a bare/public storage URL).
    url: `/api/skills/${skill.slug}/raw?version=${encodeURIComponent(version.version)}`,
    format: skill.skillFormat,
    checksum: version.checksumSha256,
    manifest: version.manifestJson,
  });
}
