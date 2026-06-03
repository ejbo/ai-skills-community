import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { parseSemver, compareSemver, formatSemver, type Semver } from '@/lib/version';

const MAX_BYTES = 5 * 1024 * 1024;

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

async function loadOwned(slug: string, userId: string, isAdmin: boolean) {
  const skill = await prisma.skill.findUnique({
    where: { slug },
    include: { versions: { select: { major: true, minor: true, patch: true, version: true } } },
  });
  if (!skill || skill.deletedAt) return null;
  if (skill.authorId !== userId && !isAdmin) return 'forbidden' as const;
  return skill;
}

// Upload a NEW version of an existing skill (owner/admin). Version number is read
// from the SKILL.md frontmatter (overridable via the `version` field) and must be
// strictly greater than every existing version. On publish it becomes current.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const owned = await loadOwned(params.slug, session.user.id, Boolean(session.user.isAdmin));
  if (owned === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (owned === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  const changelog = str(form, 'changelog') ?? '';
  const versionOverride = str(form, 'version');
  const publish = form.get('publish') !== 'false' && form.get('publish') !== '0'; // default true

  if (!(file instanceof File)) return NextResponse.json({ error: 'file_missing' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large', max_bytes: MAX_BYTES }, { status: 413 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 });

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

  const versionStr =
    versionOverride || (typeof parsed.manifest.version === 'string' ? parsed.manifest.version : '');
  const semver = parseSemver(versionStr);
  if (!semver) {
    return NextResponse.json({ error: 'invalid_version', version: versionStr || null }, { status: 400 });
  }

  // Must exceed every existing version (across draft/published/yanked).
  let max: Semver | null = null;
  for (const v of owned.versions) {
    const cur = { major: v.major, minor: v.minor, patch: v.patch };
    if (!max || compareSemver(cur, max) > 0) max = cur;
  }
  if (max && compareSemver(semver, max) <= 0) {
    return NextResponse.json(
      { error: 'version_not_increasing', current: formatSemver(max), got: formatSemver(semver) },
      { status: 409 },
    );
  }
  if (owned.versions.some((v) => v.version === versionStr)) {
    return NextResponse.json({ error: 'version_exists', version: versionStr }, { status: 409 });
  }

  const url = await storage.put(skillBundleKey(params.slug, versionStr), buffer, 'application/zip');

  const result = await prisma.$transaction(async (tx) => {
    const v = await tx.skillVersion.create({
      data: {
        skillId: owned.id,
        version: versionStr,
        major: semver.major,
        minor: semver.minor,
        patch: semver.patch,
        changelogMd: changelog,
        storageUrl: url,
        contentInline: parsed.body,
        manifestJson: parsed.manifest as unknown as object,
        fileCount: parsed.files.length,
        totalBytes: parsed.totalBytes,
        checksumSha256: parsed.checksum,
        tokenCost: parsed.tokenCost,
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
    // A freshly published version becomes current; the skill flips to bundle
    // format so the new files render. Draft versions don't touch `current`.
    if (publish) {
      await tx.skill.update({
        where: { id: owned.id },
        data: { currentVersionId: v.id, skillFormat: 'bundle', tokenCostEstimate: parsed.tokenCost },
      });
    }
    return v;
  });

  return NextResponse.json({
    ok: true,
    version: { id: result.id, version: result.version, status: result.status },
  });
}
