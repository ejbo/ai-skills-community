import kleur from 'kleur';
import { loadConfig, resolveScope, type ResolvedScope } from '../config.js';
import { ApiClient } from '../api.js';
import { listInstalled } from '../meta.js';

export async function listCommand(opts: { target?: string; global?: boolean; all?: boolean }) {
  const cfg = await loadConfig();
  const scopes: ResolvedScope[] = opts.all
    ? [
        resolveScope(cfg, { target: opts.target, global: false }),
        resolveScope(cfg, { target: opts.target, global: true }),
      ]
    : [resolveScope(cfg, opts)];

  const api = new ApiClient(cfg);
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (seen.has(scope.dir)) continue;
    seen.add(scope.dir);
    const label = scope.scope === 'global' ? '全局' : '项目';
    const installed = await listInstalled(scope.dir);
    if (installed.length === 0) {
      console.log(kleur.dim(`  [${label}] ${scope.dir} 下还没装任何 Skill。`));
      continue;
    }
    const { results } = await api.checkUpdates(
      installed.map((m) => ({ slug: m.slug, installed_version: m.installed_version })),
    );
    const byslug = new Map(results.map((r) => [r.slug, r]));

    console.log(kleur.dim(`  [${label}] ${scope.dir}`));
    for (const m of installed) {
      const r = byslug.get(m.slug);
      let status: string;
      if (!r?.found) status = kleur.dim('● 已下架');
      else if (r.has_update) status = kleur.yellow(`▲ 有更新 → ${r.latest_version}`);
      else status = kleur.green('● 最新');
      const sub = m.subscribed ? kleur.cyan(' [订阅]') : '';
      console.log(`    ${kleur.bold(m.slug)}@${m.installed_version}  ${status}${sub}`);
    }
    console.log();
  }
}
