// Client-side staging helpers shared by the unified upload form and the
// new-version uploader: drag/drop a tree of files or a .zip, dedupe, re-zip for
// upload, read text for AI/frontmatter, and a light frontmatter parse.

import JSZip from 'jszip';
import yaml from 'js-yaml';

export interface StagedFile {
  path: string; // relative path inside the package
  size: number;
  file?: File; // original File, re-zipped on upload
  bytes?: Uint8Array; // content for entries extracted from a dropped .zip
}

export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'rst', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml',
  'yml', 'toml', 'ini', 'cfg', 'sh', 'bash', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp',
  'sql', 'html', 'css', 'xml', 'csv', 'env', 'lua',
]);

function ext(path: string): string {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
}

export function isTextPath(path: string): boolean {
  return TEXT_EXT.has(ext(path)) || /(^|\/)(readme|license|skill\.md)/i.test(path);
}

export function hasSkillMd(files: StagedFile[]): boolean {
  return files.some((f) => /(^|\/)SKILL\.md$/i.test(f.path));
}

export function findReadme(files: StagedFile[]): StagedFile | undefined {
  return files.find((f) => /(^|\/)readme(\.md|\.markdown|\.txt)?$/i.test(f.path));
}

export function findSkillMd(files: StagedFile[]): StagedFile | undefined {
  return files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
}

export function mergeStaged(prev: StagedFile[], incoming: StagedFile[]): StagedFile[] {
  const map = new Map(prev.map((f) => [f.path, f]));
  for (const f of incoming) map.set(f.path, f); // dedupe by path, later wins
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/** Turn picked/dropped {file,path} entries into staged files, auto-extracting zips. */
export async function stageRaw(entries: { file: File; path: string }[]): Promise<StagedFile[]> {
  const next: StagedFile[] = [];
  for (const { file, path } of entries) {
    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file);
      for (const name of Object.keys(zip.files)) {
        const z = zip.files[name];
        if (z.dir) continue;
        const bytes = await z.async('uint8array');
        next.push({ path: name, size: bytes.byteLength, bytes });
      }
    } else {
      next.push({ path, size: file.size, file });
    }
  }
  return next;
}

// Walk a dropped FileSystemEntry tree (folders included). webkitGetAsEntry() must
// be called synchronously during the drop; resulting entries stay valid across awaits.
function walkEntry(
  entry: FileSystemEntry,
  base: string,
  out: { file: File; path: string }[],
): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          out.push({ file, path: base + entry.name });
          resolve();
        },
        () => resolve(),
      );
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    return new Promise((resolve) => {
      const all: FileSystemEntry[] = [];
      const readBatch = () =>
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              (async () => {
                for (const e of all) await walkEntry(e, `${base}${entry.name}/`, out);
                resolve();
              })();
            } else {
              all.push(...batch);
              readBatch();
            }
          },
          () => resolve(),
        );
      readBatch();
    });
  }
  return Promise.resolve();
}

/** Extract {file,path} entries from a drop event's DataTransfer (folders included). */
export async function extractDataTransfer(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  const fsEntries = items
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
    .filter((x): x is FileSystemEntry => Boolean(x));
  if (fsEntries.length > 0) {
    const out: { file: File; path: string }[] = [];
    for (const entry of fsEntries) await walkEntry(entry, '', out);
    return out;
  }
  return Array.from(dt.files).map((file) => ({ file, path: file.name }));
}

export async function buildZip(staged: StagedFile[]): Promise<File> {
  const zip = new JSZip();
  for (const f of staged) zip.file(f.path, f.file ?? f.bytes ?? new Uint8Array());
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return new File([blob], 'skill-package.zip', { type: 'application/zip' });
}

async function readText(f: StagedFile): Promise<string> {
  if (f.file) return f.file.text();
  if (f.bytes) return new TextDecoder().decode(f.bytes);
  return '';
}

export interface StagedText {
  skillMd: string;
  readme: string | null;
  files: { path: string; content: string }[];
}

const MAX_READ_BYTES = 96 * 1024;

/** Read text content from staged files for AI context + frontmatter parsing. */
export async function readStagedText(staged: StagedFile[]): Promise<StagedText> {
  const skill = findSkillMd(staged);
  const readme = findReadme(staged);
  const skillMd = skill ? await readText(skill) : '';
  const readmeText = readme ? await readText(readme) : null;
  const files: { path: string; content: string }[] = [];
  for (const f of staged) {
    if (f === skill || f === readme) continue;
    if (!isTextPath(f.path) || f.size > MAX_READ_BYTES) continue;
    files.push({ path: f.path, content: await readText(f) });
  }
  return { skillMd, readme: readmeText, files };
}

export interface FrontmatterLite {
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  triggers?: string[];
}

/** Best-effort parse of a SKILL.md YAML frontmatter block. Never throws. */
export function parseFrontmatterLite(skillMd: string): FrontmatterLite {
  const m = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    const obj = yaml.load(m[1]) as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return {};
    const out: FrontmatterLite = {};
    if (typeof obj.name === 'string') out.name = obj.name;
    if (typeof obj.description === 'string') out.description = obj.description;
    if (typeof obj.version === 'string') out.version = obj.version;
    if (typeof obj.license === 'string') out.license = obj.license;
    if (Array.isArray(obj.triggers)) out.triggers = obj.triggers.map(String);
    return out;
  } catch {
    return {};
  }
}
