import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import { loadConfig, resolveScope, type Config, type ResolvedScope } from '../config.js';
import { ApiClient } from '../api.js';
import { listInstalled, readMeta, writeMeta } from '../meta.js';
import { installCommand } from './install.js';

interface UpdateOptions {
  target?: string;
  subscribed?: boolean;
  global?: boolean;
  all?: boolean;
}

export async function updateCommand(slug: string | undefined, opts: UpdateOptions) {
  const cfg = await loadConfig();
  const scopes: ResolvedScope[] = opts.all
    ? [
        resolveScope(cfg, { target: opts.target, global: false }),
        resolveScope(cfg, { target: opts.target, global: true }),
      ]
    : [resolveScope(cfg, opts)];

  const seen = new Set<string>();
  let scanned = 0;
  let updated = 0;
  for (const scope of scopes) {
    if (seen.has(scope.dir)) continue; // e.g. project root == home -> dirs coincide
    seen.add(scope.dir);
    const res = await updateScope(cfg, scope, slug, opts.subscribed);
    scanned += res.scanned;
    updated += res.updated;
  }

  if (scanned === 0) console.log(kleur.dim('  没有可更新的 Skill。'));
  else if (updated === 0) console.log(kleur.green('✔ 全部都是最新版。'));
  else console.log(kleur.green(`✔ ${updated} 个 Skill 已更新`));
}

async function updateScope(
  cfg: Config,
  scope: ResolvedScope,
  slug: string | undefined,
  subscribedOnly: boolean | undefined,
): Promise<{ scanned: number; updated: number }> {
  let installed = await listInstalled(scope.dir);
  if (slug) installed = installed.filter((m) => m.slug === slug);
  if (subscribedOnly) installed = installed.filter((m) => m.subscribed);
  if (installed.length === 0) return { scanned: 0, updated: 0 };

  const api = new ApiClient(cfg);
  const { results } = await api.checkUpdates(
    installed.map((m) => ({ slug: m.slug, installed_version: m.installed_version })),
  );
  const updates = results.filter((r) => r.has_update);
  const label = scope.scope === 'global' ? '全局' : '项目';

  for (const r of updates) {
    console.log(kleur.cyan(`▲ [${label}] ${r.slug}: ${r.installed_version} → ${r.latest_version}`));
    const dir = path.join(scope.dir, r.slug);
    const backup = `${dir}.bak`;
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rename(dir, backup).catch(() => undefined);
    try {
      await installCommand(`${r.slug}@${r.latest_version}`, {
        target: scope.name,
        global: scope.scope === 'global',
      });
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
  return { scanned: installed.length, updated: updates.length };
}
