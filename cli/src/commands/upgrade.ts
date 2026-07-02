import { spawnSync } from 'node:child_process';
import kleur from 'kleur';
import { loadConfig } from '../config.js';

/**
 * `skills upgrade` — reinstall the CLI itself from the current registry's
 * tarball. Separate from `skills update`, which updates installed SKILLS.
 */
export async function upgradeCommand() {
  const cfg = await loadConfig();
  const url = `${cfg.registry.replace(/\/$/, '')}/skills-cli.tgz`;
  console.log(kleur.dim(`  → npm install -g ${url}`));

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['install', '-g', url], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error('升级失败（npm 退出码非 0）。可手动执行上面打印的命令重试。');
  }
  console.log(kleur.green('✔ CLI 已升级，运行 `skills --version` 查看版本。'));
}
