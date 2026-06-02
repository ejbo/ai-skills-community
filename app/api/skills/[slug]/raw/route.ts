import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { prisma } from '@/lib/db';
import { storage, skillBundleKey } from '@/lib/storage';
import { loadAccessContext, accessDenial } from '@/lib/access';

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * The single gated, attributed byte stream for skill content. Both the web
 * "下载 SKILL.md" button and the CLI byte fetch hit this endpoint, so every
 * served download is access-checked and recorded here (and only here).
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const versionArg = url.searchParams.get('version');
  const viaArg = url.searchParams.get('via'); // 'install' | 'update' from the CLI

  const { skill, actor, grant, decision } = await loadAccessContext(params.slug, req);
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

  const isCli = req.headers.get('user-agent')?.includes('skills-cli') ?? false;
  const via = viaArg ?? (isCli ? 'install' : 'raw');

  // Attributed download log + counters (best-effort, don't block the response).
  prisma
    .$transaction([
      prisma.skill.update({ where: { id: skill.id }, data: { downloadCount: { increment: 1 } } }),
      prisma.skillVersion.update({ where: { id: version.id }, data: { downloadCount: { increment: 1 } } }),
      prisma.download.create({
        data: {
          skillId: skill.id,
          versionId: version.id,
          userId: actor?.id,
          client: isCli ? 'cli' : 'web',
          via,
          userAgent: req.headers.get('user-agent') ?? undefined,
          grantId: grant?.id ?? undefined,
          ipHash: hashIp(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
        },
      }),
    ])
    .catch(() => undefined);

  // Bundle format: stream the original zip from storage (by canonical key, so it
  // works for both the local and the Vercel Blob adapter).
  if (skill.skillFormat === 'bundle' && version.storageUrl) {
    try {
      const buf = await storage.get(skillBundleKey(skill.slug, version.version));
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${skill.slug}-${version.version}.zip"`,
        },
      });
    } catch {
      /* fall through to synthesized markdown */
    }
  }

  // Structured / fallback: synthesize SKILL.md with YAML frontmatter.
  const manifest = (version.manifestJson as Record<string, unknown> | null) ?? {};
  const frontmatter: Record<string, unknown> = {
    name: manifest.name ?? skill.name,
    description: manifest.description ?? skill.summary,
    version: version.version,
    license: skill.license ?? 'MIT',
  };
  if (Array.isArray(manifest.triggers) && manifest.triggers.length > 0) {
    frontmatter.triggers = manifest.triggers;
  }
  const body = version.contentInline ?? skill.descriptionMd ?? '';
  const content = `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${body}`;

  return new NextResponse(content, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${skill.slug}-${version.version}.md"`,
    },
  });
}
