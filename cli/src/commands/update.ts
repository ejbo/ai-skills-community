import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import { loadConfig, resolveTarget } from '../config.js';
import { ApiClient } from '../api.js';
import { listInstalled, readMeta, writeMeta } from '../meta.js';
import { installCommand } from './install.js';

interface UpdateOptions {
  target?: string;
  subscribed?: boolean;
}

export async function updateCommand(slug: string | undefined, opts: UpdateOptions) {
  const cfg = await loadConfig();
  const target = resolveTarget(cfg, opts.target);
  let installed = await listInstalled(target.path);
  if (slug) installed = installed.filter((m) => m.slug === slug);
  if (opts.subscribed) installed = installed.filter((m) => m.subscribed);

  if (installed.length === 0) {
    console.log(kleur.dim('  没有可更新的 Skill。'));
    return;
  }

  const api = new ApiClient(cfg);
  const { results } = await api.checkUpdates(
    installed.map((m) => ({ slug: m.slug, installed_version: m.installed_version })),
  );

  const updates = results.filter((r) => r.has_update);
  if (updates.length === 0) {
    console.log(kleur.green('✔ 全部都是最新版。'));
    return;
  }

  for (const r of updates) {
    console.log(kleur.cyan(`▲ ${r.slug}: ${r.installed_version} → ${r.latest_version}`));
    const dir = path.join(target.path, r.slug);
    const backup = `${dir}.bak`;
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rename(dir, backup).catch(() => undefined);
    try {
      await installCommand(`${r.slug}@${r.latest_version}`, { target: target.name });
      // preserve subscribed flag
      const existing = installed.find((m) => m.slug === r.slug);
      if (existing?.subscribed) {
        const reread = await readMeta(dir);
        if (reread) await writeMeta(dir, { ...reread, subscribed: true });
      }
      await fs.rm(backup, { recursive: true, force: true });
    } catch (e) {
      console.error(kleur.red(`  ✗ 失败 — 已回滚 ${r.slug}`));
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rename(backup, dir);
      throw e;
    }
  }
  console.log(kleur.green(`✔ ${updates.length} 个 Skill 已更新`));
}
