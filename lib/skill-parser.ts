import yauzl from 'yauzl';
import yaml from 'js-yaml';
import crypto from 'node:crypto';

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
