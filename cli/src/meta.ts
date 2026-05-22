import fs from 'node:fs/promises';
import path from 'node:path';

export interface SkillMeta {
  slug: string;
  installed_version: string;
  installed_at: string;
  checksum_sha256: string | null;
  source_url: string;
  subscribed: boolean;
  registry: string;
}

const META_NAME = '.skills-meta.json';

export async function readMeta(skillDir: string): Promise<SkillMeta | null> {
  try {
    const buf = await fs.readFile(path.join(skillDir, META_NAME), 'utf8');
    return JSON.parse(buf) as SkillMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(skillDir: string, meta: SkillMeta): Promise<void> {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, META_NAME), JSON.stringify(meta, null, 2));
}

export async function listInstalled(targetDir: string): Promise<SkillMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(targetDir);
  } catch {
    return [];
  }
  const results: SkillMeta[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = path.join(targetDir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const meta = await readMeta(full);
    if (meta) results.push(meta);
  }
  return results;
}
