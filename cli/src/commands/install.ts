import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import kleur from 'kleur';
import { loadConfig, resolveScope } from '../config.js';
import { ApiClient } from '../api.js';
import { writeMeta } from '../meta.js';

interface InstallOptions {
  target?: string;
  subscribe?: boolean;
  global?: boolean;
}

export async function installCommand(spec: string, opts: InstallOptions) {
  const [slug, version] = spec.split('@');
  const cfg = await loadConfig();
  const api = new ApiClient(cfg);
  const scope = resolveScope(cfg, opts);
  const skillDir = path.join(scope.dir, slug);

  const where =
    scope.scope === 'global' ? '全局' : scope.inGitProject ? '项目' : '当前目录(非 git)';
  console.log(kleur.dim(`  → ${cfg.registry}  (${where}: ${scope.dir})`));

  // Metadata first (gated: throws an actionable error on 401/403).
  const meta = await api.download(slug, version);

  await fs.mkdir(skillDir, { recursive: true });

  // Always fetch the bytes through the gated, attributed /raw stream so private/
  // restricted skills are enforced and every install is logged to the real user.
  const res = await api.rawFetch(slug, meta.version, 'install');
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('zip') || meta.format === 'bundle') {
    const buf = Buffer.from(await res.arrayBuffer());
    await extractZip(buf, skillDir);
  } else {
    const text = await res.text();
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), text);
  }

  const checksumValid = meta.checksum ? verifyChecksum(meta.checksum, skillDir) : Promise.resolve(true);
  if (!(await checksumValid)) {
    console.warn(kleur.yellow('  ⚠ checksum 校验失败（已安装但内容可能不完整）'));
  }

  await writeMeta(skillDir, {
    slug,
    installed_version: meta.version,
    installed_at: new Date().toISOString(),
    checksum_sha256: meta.checksum ?? null,
    source_url: api.raw(slug, meta.version),
    subscribed: opts.subscribe ?? false,
    registry: cfg.registry,
    scope: scope.scope,
  });

  console.log(kleur.green(`✔ 安装 ${kleur.bold(slug)}@${meta.version}`));
  console.log(kleur.dim(`  → ${skillDir}`));
}

async function verifyChecksum(expected: string, dir: string): Promise<boolean> {
  try {
    const skillMd = await fs.readFile(path.join(dir, 'SKILL.md'));
    const actual = crypto.createHash('sha256').update(skillMd).digest('hex');
    return actual === expected;
  } catch {
    return true; // can't compute (e.g., zip with multiple files) → skip
  }
}

function extractZip(buf: Buffer, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      zip.readEntry();
      zip.on('entry', (entry) => {
        const target = path.join(destDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdir(target, { recursive: true }).then(() => zip.readEntry()).catch(reject);
          return;
        }
        zip.openReadStream(entry, async (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('read entry failed'));
          await fs.mkdir(path.dirname(target), { recursive: true });
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', async () => {
            await fs.writeFile(target, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', resolve);
      zip.on('error', reject);
    });
  });
}
