import kleur from 'kleur';
import { loadConfig, saveConfig, CONFIG_FILE_PATH } from '../config.js';

export async function logoutCommand() {
  const cfg = await loadConfig();
  if (!cfg.token) {
    console.log(kleur.dim('  当前未登录。'));
    return;
  }
  cfg.token = null;
  await saveConfig(cfg);
  console.log(kleur.green('✔ 已退出登录（已清除本地 token）') + kleur.dim(` — ${CONFIG_FILE_PATH}`));
}
