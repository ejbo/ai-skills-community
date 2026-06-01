import path from 'node:path';
import kleur from 'kleur';
import { loadConfig, resolveScope } from '../config.js';
import { readMeta, writeMeta } from '../meta.js';

export async function subscribeCommand(
  slug: string,
  opts: { target?: string; off?: boolean; global?: boolean },
) {
  const cfg = await loadConfig();
  const scope = resolveScope(cfg, opts);
  const dir = path.join(scope.dir, slug);
  const meta = await readMeta(dir);
  if (!meta) {
    const g = opts.global ? ' -g' : '';
    console.error(kleur.red(`✗ ${scope.scope === 'global' ? '全局' : '项目'}未安装 ${slug}，先 \`skills install ${slug}${g}\``));
    process.exit(1);
  }
  await writeMeta(dir, { ...meta, subscribed: !opts.off });
  console.log(kleur.green(opts.off ? `✔ 已取消订阅 ${slug}` : `✔ 已订阅 ${slug} — 下次 \`skills update\` 会自动拉新版`));
}
