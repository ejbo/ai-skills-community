import yauzl from 'yauzl';
import yaml from 'js-yaml';
import crypto from 'node:crypto';

export const MAX_TEXT_FILE_CHARS = 256 * 1024;

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'rst', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash',
  'zsh', 'fish', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'php', 'swift', 'scala', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg',
  'csv', 'tsv', 'log', 'gitignore', 'dockerignore', 'editorconfig', 'gitattributes',
  'lock', 'properties', 'gradle', 'makefile', 'make', 'mk', 'r', 'lua', 'pl', 'vim',
  'dot', 'graphql', 'proto', 'tf', 'tfvars',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'pdf', 'zip', 'gz', 'tar',
  'tgz', 'rar', '7z', 'mp3', 'mp4', 'wav', 'ogg', 'mov', 'avi', 'woff', 'woff2', 'ttf',
  'otf', 'eot', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'pyc',
]);

function extensionOf(path: string): string {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  const name = base.startsWith('.') ? base.slice(1) : base;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

export function isProbablyText(path: string, buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false; // null byte → binary
  }
  const ext = extensionOf(path);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true; // no null byte and unknown extension → treat as text
}

export interface SkillManifest {
  name: string;
  description?: string;
  triggers?: string[];
  version?: string;
  license?: string;
  dependencies?: string[];
  [key: string]: unknown;
}

export interface ParsedBundle {
  manifest: SkillManifest;
  body: string;
  files: Array<{ path: string; size: number }>;
  totalBytes: number;
  checksum: string;
  tokenCost: number;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function parseFrontmatter(content: string): { manifest: SkillManifest; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('SKILL.md is missing YAML frontmatter');
  }
  const manifest = yaml.load(match[1]) as SkillManifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('SKILL.md frontmatter is not a valid YAML object');
  }
  if (!manifest.name) throw new Error('SKILL.md frontmatter is missing "name"');
  return { manifest, body: match[2] ?? '' };
}

export function estimateTokenCost(body: string): number {
  // Cheap heuristic: ~4 chars/token (matches GPT-style tokenizers).
  return Math.ceil(body.length / 4);
}

export async function parseSkillBundle(zipBuffer: Buffer): Promise<ParsedBundle> {
  const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  const files: Array<{ path: string; size: number }> = [];
  let skillMd: string | null = null;
  let totalBytes = 0;

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, z) => {
      if (err || !z) return reject(err ?? new Error('Failed to open zip'));
      resolve(z);
    });
  });

  await new Promise<void>((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry) => {
      if (/\/$/.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      totalBytes += entry.uncompressedSize;
      files.push({ path: entry.fileName, size: entry.uncompressedSize });
      if (/(^|\/)SKILL\.md$/i.test(entry.fileName) && skillMd === null) {
        zip.openReadStream(entry, async (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('open stream failed'));
          try {
            const buf = await streamToBuffer(stream);
            skillMd = buf.toString('utf8');
          } catch (e) {
            return reject(e);
          }
          zip.readEntry();
        });
      } else {
        zip.readEntry();
      }
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
  });

  if (skillMd === null) {
    throw new Error('Bundle does not contain a SKILL.md file');
  }

  const { manifest, body } = parseFrontmatter(skillMd);
  return {
    manifest,
    body,
    files,
    totalBytes,
    checksum,
    tokenCost: estimateTokenCost(body),
  };
}
