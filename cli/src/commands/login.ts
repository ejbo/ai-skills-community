import kleur from 'kleur';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, saveConfig, CONFIG_FILE_PATH } from '../config.js';

export async function loginCommand(opts: { registry?: string }) {
  const cfg = await loadConfig();
  if (opts.registry) cfg.registry = opts.registry;

  console.log(kleur.dim('  Registry: ') + cfg.registry);
  console.log(kleur.dim('  在浏览器打开 ') + kleur.cyan(`${cfg.registry}/settings/tokens`) + kleur.dim(' 创建一个 token，'));
  console.log(kleur.dim('  然后粘贴到下方。'));
  console.log();

  const rl = readline.createInterface({ input, output });
  const token = (await rl.question('Token: ')).trim();
  rl.close();

  if (!token.startsWith('scm_pat_')) {
    console.error(kleur.red('✗ 不是合法的 token 格式（应以 scm_pat_ 开头）'));
    process.exit(1);
  }

  cfg.token = token;
  await saveConfig(cfg);
  console.log(kleur.green('✔ 已保存到 ') + CONFIG_FILE_PATH);
}
