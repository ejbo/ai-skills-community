import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { selectReadme } from '@/lib/skill-context';

const MAX_BYTES = 512 * 1024 * 1024; // 512MB (internal deploy; nginx caps the rest)

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Parse a list field that may be JSON (`["a","b"]`) or comma/space separated. */
function list(form: FormData, key: string): string[] | undefined {
  const raw = form.get(key);
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* not JSON — fall through */
  }
  return raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  const publish = form.get('publish') === 'true' || form.get('publish') === '1';
  const visibilityField = form.get('visibility');
  const visibility =
    visibilityField === 'restricted' || visibilityField === 'private' ? visibilityField : 'public';
  // Author-selected source category (外部 / 官方搬运 / 内部) — no permission gate.
  const sourceTypeField = form.get('sourceType');
  const sourceType =
    sourceTypeField === 'internal' || sourceTypeField === 'curated' ? sourceTypeField : 'external';

  // Author-supplied metadata overrides (from the unified upload form). When a
  // field is absent we derive it from the SKILL.md manifest / README instead.
  const nameOverride = str(form, 'name');
  const summaryOverride = str(form, 'summary');
  const slugOverride = str(form, 'slug');
  const licenseOverride = str(form, 'license');
  const categoryId = str(form, 'categoryId');
  const tagsOverride = list(form, 'tags');
  const triggersOverride = list(form, 'triggers');
  const tokenCostRaw = str(form, 'tokenCostEstimate');
  const tokenCostOverride = tokenCostRaw !== undefined ? Number(tokenCostRaw) : undefined;

  // Overview source: 'readme' (use the bundle's README.md) or 'custom' (author-written).
  // SKILL.md is never used as the public overview — it lives in Files only.
  const overviewSource = form.get('overviewSource') === 'custom' ? 'custom' : 'readme';
  const customOverview = (str(form, 'customOverview') ?? '').slice(0, 50000);

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
    return NextResponse.json(
      { error: 'parse_failed', reason: e instanceof Error ? e.message : 'unknown' },
      { status: 400 },
    );
  }

  const manifest = parsed.manifest;
  const slug = slugify(
    slugOverride || (typeof manifest.name === 'string' ? manifest.name : 'skill') || 'skill',
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

  const triggers = triggersOverride ?? (Array.isArray(manifest.triggers) ? manifest.triggers : []);
  const tokenCost =
    tokenCostOverride !== undefined && Number.isFinite(tokenCostOverride) && tokenCostOverride >= 0
      ? Math.min(Math.round(tokenCostOverride), 50000)
      : parsed.tokenCost;

  const storageKey = skillBundleKey(slug, version);
  const url = await storage.put(storageKey, buffer, 'application/zip');

  const created = await prisma.$transaction(async (tx) => {
    const skill = await tx.skill.create({
      data: {
        slug,
        name: nameOverride ?? String(manifest.name ?? slug),
        summary:
          (summaryOverride ?? String(manifest.description ?? '')).slice(0, 200) ||
          `${manifest.name ?? slug}`,
        descriptionMd:
          overviewSource === 'custom' ? customOverview : selectReadme(parsed.files) ?? '',
        authorId: session.user.id,
        categoryId: categoryId ?? null,
        sourceType,
        skillFormat: 'bundle',
        status: publish ? 'published' : 'draft',
        visibility,
        tokenCostEstimate: tokenCost,
        license: licenseOverride ?? (typeof manifest.license === 'string' ? manifest.license : 'MIT'),
        structuredPayload: triggers.length > 0 ? { triggers } : undefined,
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
        tokenCost,
        status: publish ? 'published' : 'draft',
        publishedAt: publish ? new Date() : null,
      },
    });
    if (parsed.files.length > 0) {
      await tx.skillFile.createMany({
        data: parsed.files.map((f) => ({
          versionId: v.id,
          path: f.path,
          size: f.size,
          isText: f.isText,
          content: f.content,
          truncated: f.truncated,
        })),
      });
    }
    await tx.skill.update({ where: { id: skill.id }, data: { currentVersionId: v.id } });

    if (tagsOverride && tagsOverride.length > 0) {
      for (const tagName of tagsOverride) {
        const tagSlug = tagName.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!tagSlug) continue;
        const tag = await tx.tag.upsert({
          where: { slug: tagSlug },
          update: { usageCount: { increment: 1 } },
          create: { slug: tagSlug, name: tagName, usageCount: 1 },
        });
        await tx.skillTag.upsert({
          where: { skillId_tagId: { skillId: skill.id, tagId: tag.id } },
          update: {},
          create: { skillId: skill.id, tagId: tag.id },
        });
      }
    }
    return skill;
  });

  return NextResponse.json({
    ok: true,
    skill: { slug: created.slug, id: created.id, status: created.status },
    parsed: {
      name: created.name,
      description: created.summary,
      version,
      fileCount: parsed.files.length,
      totalBytes: parsed.totalBytes,
      tokenCost,
    },
  });
}
