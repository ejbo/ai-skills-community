import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type Scope = 'global' | 'project';

export interface SkillTarget {
  name: string;
  /** Legacy/global path — kept so old config.json files still load. */
  path?: string;
  /** Per-scope base dirs. user = global (under ~); project = relative to the project root. */
  scopes?: { user?: string | null; project?: string | null };
}

export interface Config {
  registry: string;
  token: string | null;
  defaultTarget: string;
  targets: SkillTarget[];
}

const CONFIG_DIR = path.join(os.homedir(), '.skills');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Resolution order for the Skills server address (highest precedence first):
//   1. SKILLS_REGISTRY        — runtime override; the global `--registry` flag sets this too
//   2. registry saved in config.json (by a prior `skills login`)
//   3. SKILLS_DEFAULT_REGISTRY — baked in at BUILD time by tsup (see tsup.config.ts)
//   4. http://localhost:3000   — dev fallback
// Resolved at loadConfig() CALL time (NOT module load) so the `--registry` flag — which the
// preAction hook in index.ts turns into SKILLS_REGISTRY before the command runs — takes effect.
function baseConfig(): Config {
  return {
    registry: process.env.SKILLS_DEFAULT_REGISTRY ?? 'http://localhost:3000',
    token: null,
    defaultTarget: 'claude-code',
    targets: [
      {
        name: 'claude-code',
        path: path.join(os.homedir(), '.claude', 'skills'),
        scopes: {
          user: path.join(os.homedir(), '.claude', 'skills'), // global  (skills install -g)
          project: '.claude/skills', // project (skills install, default) — relative to project root
        },
      },
    ],
  };
}

export async function loadConfig(): Promise<Config> {
  let cfg = baseConfig();
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    cfg = { ...cfg, ...parsed };
  } catch {
    // no saved config yet — use defaults
  }
  // Runtime override (SKILLS_REGISTRY env, or the --registry flag that sets it) beats a
  // registry persisted in config.json by an earlier `login` — so one CLI can target whichever
  // server the install command came from, regardless of what was baked in or saved.
  const runtime = process.env.SKILLS_REGISTRY?.replace(/\/$/, '');
  if (runtime) cfg.registry = runtime;
  return cfg;
}

export async function saveConfig(cfg: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  await fs.chmod(CONFIG_PATH, 0o600).catch(() => undefined);
}

export interface ResolvedScope {
  /** target (agent) name */
  name: string;
  scope: Scope;
  /** absolute skills directory, NOT including the slug */
  dir: string;
  /** project scope only: true if a git project root was found */
  inGitProject: boolean;
}

/** Walk up from `start` to the nearest git root; fall back to `start` if none. */
export function findProjectRoot(start: string = process.cwd()): { root: string; isGit: boolean } {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return { root: dir, isGit: true };
    const parent = path.dirname(dir);
    if (parent === dir) return { root: start, isGit: false };
    dir = parent;
  }
}

/**
 * Decide WHERE a skill is installed / read from.
 * Default scope = the current project (<project-root>/.claude/skills).
 * Pass { global: true } (the `-g` flag) for the user-global dir (~/.claude/skills).
 * Throws on an unknown --target instead of silently falling back to targets[0].
 */
export function resolveScope(
  cfg: Config,
  opts: { target?: string; global?: boolean } = {},
): ResolvedScope {
  const name = opts.target ?? cfg.defaultTarget;
  const t = cfg.targets.find((x) => x.name === name);
  if (!t) {
    throw new Error(`未知 target「${name}」。可用: ${cfg.targets.map((x) => x.name).join(', ')}`);
  }
  if (opts.global) {
    const base = t.scopes?.user ?? t.path ?? path.join(os.homedir(), '.claude', 'skills');
    return { name: t.name, scope: 'global', dir: expand(base), inGitProject: false };
  }
  const rel = t.scopes?.project ?? '.claude/skills';
  if (path.isAbsolute(rel)) {
    return { name: t.name, scope: 'project', dir: rel, inGitProject: false };
  }
  const { root, isGit } = findProjectRoot();
  return { name: t.name, scope: 'project', dir: path.join(root, rel), inGitProject: isGit };
}

function expand(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
