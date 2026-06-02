import 'dotenv/config';
import { prisma } from '@/lib/db';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { selectReadme } from '@/lib/skill-context';

async function main() {
  const skills = await prisma.skill.findMany({
    where: { skillFormat: 'bundle' },
    include: { versions: true },
  });
  console.log(`Found ${skills.length} bundle skills`);

  for (const skill of skills) {
    for (const version of skill.versions) {
      if (!version.storageUrl) continue;
      const existing = await prisma.skillFile.count({ where: { versionId: version.id } });
      if (existing > 0) {
        console.log(`  skip ${skill.slug}@${version.version} (already has ${existing} files)`);
        continue;
      }
      let buf: Buffer;
      try {
        buf = await storage.get(skillBundleKey(skill.slug, version.version));
      } catch (e) {
        console.warn(`  ! cannot read zip for ${skill.slug}@${version.version}: ${String(e)}`);
        continue;
      }
      const parsed = await parseSkillBundle(buf);
      if (parsed.files.length > 0) {
        await prisma.skillFile.createMany({
          data: parsed.files.map((file) => ({
            versionId: version.id,
            path: file.path,
            size: file.size,
            isText: file.isText,
            content: file.content,
            truncated: file.truncated,
          })),
          skipDuplicates: true,
        });
      }
      console.log(`  + ${skill.slug}@${version.version}: ${parsed.files.length} files`);

      // Fix Overview source for the current version: README (else empty -> summary fallback in UI)
      if (skill.currentVersionId === version.id) {
        const readme = selectReadme(parsed.files);
        await prisma.skill.update({
          where: { id: skill.id },
          data: { descriptionMd: readme ?? '' },
        });
        console.log(`    overview descriptionMd <- ${readme ? 'README' : '(empty, falls back to summary)'}`);
      }
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
