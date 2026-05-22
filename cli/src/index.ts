#!/usr/bin/env node
import { Command } from 'commander';
import kleur from 'kleur';
import { loginCommand } from './commands/login.js';
import { searchCommand } from './commands/search.js';
import { installCommand } from './commands/install.js';
import { listCommand } from './commands/list.js';
import { updateCommand } from './commands/update.js';
import { subscribeCommand } from './commands/subscribe.js';

const program = new Command();

program
  .name('skills')
  .description('Skills Community CLI — install / update AI agent skills.')
  .version('0.1.0');

program
  .command('login')
  .description('保存 CLI Token（先到网页 /settings/tokens 创建）')
  .option('--registry <url>', '指向的注册中心 URL')
  .action((opts) => loginCommand(opts).catch(fail));

program
  .command('search <query>')
  .description('搜索 skill')
  .action((q) => searchCommand(q).catch(fail));

program
  .command('install <slug[@version]>')
  .description('安装一个 skill 到本地 ~/.claude/skills/')
  .option('-t, --target <name>', '目标 (claude-code / cursor / ...)')
  .option('-s, --subscribe', '同时订阅自动更新')
  .action((spec, opts) => installCommand(spec, opts).catch(fail));

program
  .command('list')
  .alias('ls')
  .description('列出本地已装的 skill 及更新状态')
  .option('-t, --target <name>', '目标')
  .action((opts) => listCommand(opts).catch(fail));

program
  .command('update [slug]')
  .description('拉取已订阅 skill 的最新版本')
  .option('-t, --target <name>', '目标')
  .option('-s, --subscribed', '只更新订阅了的')
  .action((slug, opts) => updateCommand(slug, opts).catch(fail));

program
  .command('subscribe <slug>')
  .description('订阅一个本地已装 skill 的更新')
  .option('-t, --target <name>', '目标')
  .option('--off', '取消订阅')
  .action((slug, opts) => subscribeCommand(slug, opts).catch(fail));

program.parse();

function fail(err: unknown) {
  console.error(kleur.red('✗ ') + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
