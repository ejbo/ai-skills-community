import kleur from 'kleur';
import { loadConfig, resolveTarget } from '../config.js';
import { ApiClient } from '../api.js';
import { listInstalled } from '../meta.js';

export async function listCommand(opts: { target?: string }) {
  const cfg = await loadConfig();
  const target = resolveTarget(cfg, opts.target);
  const installed = await listInstalled(target.path);
  if (installed.length === 0) {
    console.log(kleur.dim(`  ${target.path} 下还没装任何 Skill。`));
    return;
  }
  const api = new ApiClient(cfg);
  const { results } = await api.checkUpdates(
    installed.map((m) => ({ slug: m.slug, installed_version: m.installed_version })),
  );
  const byslug = new Map(results.map((r) => [r.slug, r]));

  console.log(kleur.dim(`  Target: ${target.name} (${target.path})`));
  console.log();
  for (const m of installed) {
    const r = byslug.get(m.slug);
    let status: string;
    if (!r?.found) status = kleur.dim('● 已下架');
    else if (r.has_update) status = kleur.yellow(`▲ 有更新 → ${r.latest_version}`);
    else status = kleur.green('● 最新');
    const sub = m.subscribed ? kleur.cyan(' [订阅]') : '';
    console.log(`  ${kleur.bold(m.slug)}@${m.installed_version}  ${status}${sub}`);
  }
}
