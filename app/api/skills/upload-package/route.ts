import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';

const MAX_BYTES = 5 * 1024 * 1024;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const publishField = form?.get('publish');
  const slugOverride = form?.get('slug');
  const visibilityField = form?.get('visibility');
  const visibility =
    visibilityField === 'restricted' || visibilityField === 'private'
      ? visibilityField
      : 'public';
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_missing' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large', max_bytes: MAX_BYTES }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseSkillBundle(buffer);
  } catch (e) {
    return NextResponse.json({ error: 'parse_failed', reason: e instanceof Error ? e.message : 'unknown' }, { status: 400 });
  }

  const manifest = parsed.manifest;
  const slug = slugify(
    (typeof slugOverride === 'string' && slugOverride) ||
      (typeof manifest.name === 'string' ? manifest.name : 'skill') ||
      'skill',
  );
  if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  const existing = await prisma.skill.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: 'slug_taken', slug }, { status: 409 });
  }

  const version = (typeof manifest.version === 'string' && manifest.version) || '1.0.0';
  const versionParts = version.split('.').map((n) => Number.parseInt(n, 10));
  if (versionParts.length !== 3 || versionParts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: 'invalid_version', version }, { status: 400 });
  }
  const [major, minor, patch] = versionParts;

  const storageKey = skillBundleKey(slug, version);
  const url = await storage.put(storageKey, buffer, 'application/zip');

  const publish = publishField === 'true' || publishField === '1';

  const created = await prisma.$transaction(async (tx) => {
    const skill = await tx.skill.create({
      data: {
        slug,
        name: String(manifest.name ?? slug),
        summary: String(manifest.description ?? '').slice(0, 200) || `${manifest.name ?? slug}`,
        descriptionMd: parsed.body,
        authorId: session.user.id,
        sourceType: 'user_uploaded',
        skillFormat: 'bundle',
        status: publish ? 'published' : 'draft',
        visibility,
        tokenCostEstimate: parsed.tokenCost,
        license: typeof manifest.license === 'string' ? manifest.license : 'MIT',
        structuredPayload: Array.isArray(manifest.triggers)
          ? { triggers: manifest.triggers }
          : undefined,
      },
    });
    const v = await tx.skillVersion.create({
      data: {
        skillId: skill.id,
        version,
        major,
        minor,
        patch,
        storageUrl: url,
        contentInline: parsed.body,
        manifestJson: manifest as unknown as object,
        fileCount: parsed.files.length,
        totalBytes: parsed.totalBytes,
        checksumSha256: parsed.checksum,
        tokenCost: parsed.tokenCost,
        status: publish ? 'published' : 'draft',
        publishedAt: publish ? new Date() : null,
      },
    });
    await tx.skill.update({ where: { id: skill.id }, data: { currentVersionId: v.id } });
    return skill;
  });

  return NextResponse.json({
    ok: true,
    skill: { slug: created.slug, id: created.id, status: created.status },
    parsed: {
      name: manifest.name,
      description: manifest.description,
      version,
      fileCount: parsed.files.length,
      totalBytes: parsed.totalBytes,
      tokenCost: parsed.tokenCost,
    },
  });
}
