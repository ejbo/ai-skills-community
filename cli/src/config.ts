import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface SkillTarget {
  name: string;
  path: string;
}

export interface Config {
  registry: string;
  token: string | null;
  defaultTarget: string;
  targets: SkillTarget[];
}

const CONFIG_DIR = path.join(os.homedir(), '.skills');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Resolution order for the Skills server address:
//   1. SKILLS_REGISTRY        — runtime override on the user's machine (read at run time)
//   2. SKILLS_DEFAULT_REGISTRY — baked in at BUILD time by tsup (see tsup.config.ts)
//   3. localhost fallback      — dev default when nothing was baked in
const DEFAULT: Config = {
  registry:
    process.env.SKILLS_REGISTRY ??
    process.env.SKILLS_DEFAULT_REGISTRY ??
    'http://localhost:3000',
  token: null,
  defaultTarget: 'claude-code',
  targets: [
    { name: 'claude-code', path: path.join(os.homedir(), '.claude', 'skills') },
  ],
};

export async function loadConfig(): Promise<Config> {
  try {
    const buf = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(buf);
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  await fs.chmod(CONFIG_PATH, 0o600).catch(() => undefined);
}

export function resolveTarget(cfg: Config, name?: string): SkillTarget {
  const target = cfg.targets.find((t) => t.name === (name ?? cfg.defaultTarget));
  if (target) return { ...target, path: expand(target.path) };
  return { ...cfg.targets[0], path: expand(cfg.targets[0].path) };
}

function expand(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
