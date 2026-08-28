import yauzl from 'yauzl';
import yaml from 'js-yaml';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

// Internal deploy — intentionally generous (was 256KB). Bounds in-DB text size
// without rejecting any realistic skill doc.
export const MAX_TEXT_FILE_CHARS = 8 * 1024 * 1024;

// Zip-bomb guards. The upload routes cap the COMPRESSED body (512MB), which
// bounds TRANSPORT only: deflate reaches ~1000:1 on repetitive data, so a
// 0.29MB bundle carrying one 300MB file of 'A' sails through the transport cap
// and used to drive this function to ~974MB RSS — enough to OOM the single Node
// process and drop every other user's page load, video stream and SSE chat.
// These are memory protection, not policy: a real skill bundle is docs plus
// scripts (a few MB, tens of files), so each ceiling sits orders of magnitude
// above anything legitimate — including any bundle already in storage, which
// lib/skill-files.ts re-parses lazily.
const MAX_ENTRIES = 4096;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // 8x the per-file text budget above
const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // whole-bundle expansion budget

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

export interface ParsedFile {
  path: string;
  size: number;
  isText: boolean;
  content: string | null;
  truncated: boolean;
}

export interface ParsedBundle {
  manifest: SkillManifest;
  body: string;
  files: ParsedFile[];
  totalBytes: number;
  checksum: string;
  tokenCost: number;
}

/**
 * Buffer one zip entry, aborting the moment more than `limit` bytes arrive.
 * Destroying the stream is the point: letting a bomb finish inflating IS the
 * DoS. yauzl's own `validateEntrySizes` assertion is not a substitute — it only
 * catches an entry that delivers MORE than its header declared, and the bomb
 * that matters declares its 300MB perfectly honestly.
 */
function streamToBufferCapped(stream: Readable, limit: number, overflow: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        chunks.length = 0; // release what we already hold before unwinding
        stream.destroy();
        reject(new Error(overflow));
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Decode an entry's text without materialising the whole thing as a string:
 * `buf.toString('utf8')` allocated the FULL entry (hundreds of MB) just to
 * slice `maxChars` off the front.
 *
 * The budget is in CHARACTERS and must stay that way. Cutting at `maxChars`
 * BYTES instead silently dropped ~20% of a legitimate 10MB Chinese document —
 * its 3.5M characters fit the 8M budget with room to spare, but its byte length
 * did not, so it came back truncated. Two steps keep both properties:
 *   - a buffer no longer than the char budget can never need truncating (a
 *     UTF-8 byte never decodes to more than one UTF-16 code unit), so it decodes
 *     whole — identical output to the old full decode;
 *   - past that, decode only as many BYTES as could possibly carry `maxChars`
 *     code units. The worst ratio is 3 bytes per unit (3-byte BMP characters —
 *     CJK — at one UTF-16 unit each; 4-byte astral pairs are 2 bytes per unit
 *     and ASCII is 1), so `maxChars * 3` can never cut a character that would
 *     have fitted. Then slice in characters, exactly as the old code did.
 * StringDecoder drops a trailing partial sequence instead of emitting U+FFFD
 * for half a character.
 */
const MAX_UTF8_BYTES_PER_UTF16_UNIT = 3;

function decodeText(buf: Buffer, maxChars: number): { text: string; truncated: boolean } {
  if (buf.length <= maxChars) return { text: buf.toString('utf8'), truncated: false };
  const budget = maxChars * MAX_UTF8_BYTES_PER_UTF16_UNIT;
  const head = new StringDecoder('utf8').write(buf.subarray(0, budget));
  if (head.length <= maxChars) return { text: head, truncated: buf.length > budget };
  return { text: head.slice(0, maxChars), truncated: true };
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
  const files: ParsedFile[] = [];
  let skillMd: string | null = null;
  let totalBytes = 0;
  let entryCount = 0;

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
      if (++entryCount > MAX_ENTRIES) {
        // Rejecting without calling readEntry() ends the walk: lazyEntries means
        // nothing more is read until we ask for it.
        reject(new Error(`Bundle contains more than ${MAX_ENTRIES} files`));
        return;
      }
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      const limit = Math.min(MAX_ENTRY_BYTES, remaining);
      const overflow =
        remaining < MAX_ENTRY_BYTES
          ? `Bundle expands past ${MAX_TOTAL_BYTES / 1024 / 1024}MB at "${entry.fileName}"`
          : `Entry "${entry.fileName}" expands past ${MAX_ENTRY_BYTES / 1024 / 1024}MB`;
      // Cheap early-out on the size the zip header DECLARES — it costs nothing
      // and stops an honest 300MB entry before a byte is inflated. Never the
      // real guard though: lying about that field is exactly what a zip bomb
      // does, so streamToBufferCapped counts the bytes that actually arrive.
      if (entry.uncompressedSize > limit) {
        reject(new Error(overflow));
        return;
      }
      zip.openReadStream(entry, async (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('open stream failed'));
        try {
          const buf = await streamToBufferCapped(stream, limit, overflow);
          totalBytes += buf.length;
          const isText = isProbablyText(entry.fileName, buf);
          let content: string | null = null;
          let truncated = false;
          if (isText) {
            const decoded = decodeText(buf, MAX_TEXT_FILE_CHARS);
            content = decoded.text;
            truncated = decoded.truncated;
            // SKILL.md rides the same budget rather than keeping a second, full
            // copy of the entry — frontmatter sits at the very top, and an 8MB
            // SKILL.md is already far past anything real.
            if (/(^|\/)SKILL\.md$/i.test(entry.fileName) && skillMd === null) {
              skillMd = decoded.text;
            }
          }
          files.push({ path: entry.fileName, size: buf.length, isText, content, truncated });
          zip.readEntry();
        } catch (e) {
          reject(e);
        }
      });
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
