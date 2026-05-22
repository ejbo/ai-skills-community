import path from 'node:path';
import kleur from 'kleur';
import { loadConfig, resolveTarget } from '../config.js';
import { readMeta, writeMeta } from '../meta.js';

export async function subscribeCommand(
  slug: string,
  opts: { target?: string; off?: boolean },
) {
  const cfg = await loadConfig();
  const target = resolveTarget(cfg, opts.target);
  const dir = path.join(target.path, slug);
  const meta = await readMeta(dir);
  if (!meta) {
    console.error(kleur.red(`✗ 本地未安装 ${slug}，先 \`skills install ${slug}\``));
    process.exit(1);
  }
  await writeMeta(dir, { ...meta, subscribed: !opts.off });
  console.log(kleur.green(opts.off ? `✔ 已取消订阅 ${slug}` : `✔ 已订阅 ${slug} — 下次 \`skills update\` 会自动拉新版`));
}
