// File-type decisions — the ONE table that decides how an uploaded file is
// stored, served and previewed. Import-free and client-safe on purpose: the
// upload routes, the byte-serving routes (lib/uploads/serve.ts), the composer's
// classify(), the attachment badges and the file viewer all read it, so the
// badge on a card, the Content-Type on the wire and the branch the preview
// panel takes can never disagree again (they used to: text files were
// previewable in the panel but badged as nothing, and a `.log` could be stored
// as `.txt` while its card said LOG).
//
// Three rules carry the security of "any file can be attached":
//   1. The STORAGE KEY's extension is the truth. It is derived once, at upload,
//      by `safeKeyExt` (`[a-z0-9]{1,10}` or `bin`), and every later decision —
//      Content-Type, inline vs download, preview renderer, office conversion —
//      reads the key, never the client-supplied display name. The name is
//      display text only.
//   2. Only a closed set of media is ever served with its REAL type and
//      `inline`: raster images, mp4/webm/mov, a handful of audio formats, PDF.
//      Every text-like file (html / svg / xml / js included) goes out as
//      `text/plain; charset=utf-8`, everything else as octet-stream, and both
//      as `attachment` — so no user bytes ever become an active document on the
//      app origin. SVG is deliberately NOT an inline image: navigated to or
//      iframed, it runs script.
//   3. Preview never navigates to user bytes: html / svg / xml are shown as
//      SOURCE; text is fetched and decoded by the viewer itself.
//
// `DANGEROUS_EXTS` is a WARNING list, not a block — owner decision: every file
// type may be shared; executables and scripts just carry a caution line.

// ── Extensions ───────────────────────────────────────────────────────────────

/** Regex SOURCE of a storage-key extension. The zone / embed key regexes are built from it so they widen in lockstep. */
export const SAFE_KEY_EXT_PATTERN = '[a-z0-9]{1,10}';
const SAFE_KEY_EXT_RE = new RegExp(`^${SAFE_KEY_EXT_PATTERN}$`);
/** Stored extension for a file whose name carries no usable one (`Makefile`, `a.b-c`, an 11-char extension). */
export const FALLBACK_KEY_EXT = 'bin';

/** Multi-part archive suffixes shown whole (`TAR.GZ`) — display only; the key keeps the last part. */
const COMPOUND_EXTS = ['tar.gz', 'tar.bz2', 'tar.xz'] as const;

function baseName(name: string): string {
  const trimmed = (name ?? '').trim();
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** The last extension of a name (lowercase, 1–10 ascii letters/digits), '' when there is none. */
export function lastExtOfName(name: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(baseName(name));
  return m ? m[1].toLowerCase() : '';
}

/**
 * DISPLAY extension of a file name: lowercase, 1–10 chars, with the compound
 * archive suffixes kept whole (`data.tar.gz` → `tar.gz`). Never use it to decide
 * how bytes are served or previewed — that is the key's job (`keyExtOf`).
 */
export function extOfName(name: string): string {
  const last = lastExtOfName(name);
  if (!last) return '';
  const lower = baseName(name).toLowerCase();
  for (const c of COMPOUND_EXTS) {
    if (lower.endsWith(`.${c}`) && lower.length > c.length + 1) return c;
  }
  return last;
}

/** Extension of a storage key (`file/abc.tar` → `tar`), '' when the last segment has none. */
export function keyExtOf(key: string): string {
  const last = (key ?? '').split('?')[0].split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

const MIME_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

/** A plain extension for a MIME type ('' when unknown). Display fallback + the upload's last-resort key hint. */
export function extFromMime(mime: string | null | undefined): string {
  return MIME_EXT[(mime ?? '').split(';')[0].trim().toLowerCase()] ?? '';
}

/**
 * The extension a NEW storage key carries: the name's last extension when it is
 * `[a-z0-9]{1,10}`, else the MIME hint's (browsers report an empty type for most
 * source files, so the name comes first), else `bin`. Always matches
 * SAFE_KEY_EXT_PATTERN — a hostile filename can never store `../` or uppercase.
 */
export function safeKeyExt(name: string, mimeHint?: string | null): string {
  const fromName = lastExtOfName(name);
  if (fromName && SAFE_KEY_EXT_RE.test(fromName)) return fromName;
  const fromMime = extFromMime(mimeHint);
  return fromMime && SAFE_KEY_EXT_RE.test(fromMime) ? fromMime : FALLBACK_KEY_EXT;
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** Raster images a browser renders natively — the only images ever served inline. NOT svg (script), not heic/bmp/tiff. */
export const RASTER_IMAGE_EXTS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
export const INLINE_VIDEO_EXTS: ReadonlySet<string> = new Set(['mp4', 'webm', 'mov']);
export const INLINE_AUDIO_EXTS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac']);
/** LibreOffice-convertible documents (技术专区 renders them through a PDF rendition). */
export const OFFICE_EXTS: ReadonlySet<string> = new Set(['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'odp']);

const INLINE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
};

/**
 * Extension → highlight.js language (lib/common names; a caller checks
 * `hljs.getLanguage` before using one it may not have). Moved here from
 * components/CodeViewer.tsx so the skill file viewer and the attachment viewer
 * share one table.
 */
export const EXT_LANG: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', kts: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cxx: 'cpp', hh: 'cpp', cs: 'csharp', php: 'php', swift: 'swift', scala: 'scala',
  m: 'objectivec', mm: 'objectivec', sql: 'sql', vb: 'vbnet',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  json: 'json', jsonc: 'json', jsonl: 'json', ndjson: 'json', geojson: 'json', ipynb: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  xml: 'xml', svg: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', vue: 'xml',
  css: 'css', scss: 'scss', less: 'less', md: 'markdown', markdown: 'markdown',
  lua: 'lua', pl: 'perl', r: 'r', graphql: 'graphql', gql: 'graphql',
  diff: 'diff', patch: 'diff', gradle: 'gradle', dockerfile: 'dockerfile', makefile: 'makefile',
  ps1: 'powershell', psm1: 'powershell', bat: 'dos', cmd: 'dos',
};

/**
 * Extensions whose content is text. Moved here from lib/skill-parser.ts (which
 * imports it for `isProbablyText`); extended with the formats attachments meet.
 * Membership here is what makes a file served as `text/plain` (never its own
 * type) and previewed as text.
 */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  // skill-parser's original set
  'md', 'markdown', 'txt', 'text', 'rst', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash',
  'zsh', 'fish', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'php', 'swift', 'scala', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg',
  'csv', 'tsv', 'log', 'gitignore', 'dockerignore', 'editorconfig', 'gitattributes',
  'lock', 'properties', 'gradle', 'makefile', 'make', 'mk', 'r', 'lua', 'pl', 'vim',
  'dot', 'graphql', 'proto', 'tf', 'tfvars',
  // attachments
  ...Object.keys(EXT_LANG),
  'xhtml', 'jsonl', 'ndjson', 'geojson', 'ipynb', 'npmrc', 'nvmrc', 'srt', 'vtt', 'tex', 'bib',
  'adoc', 'org', 'rtf', 'reg', 'vbs', 'vbe', 'hta', 'wsf', 'command', 'cmake', 'bazel', 'bzl',
  'nix', 'hcl', 'sbt', 'clj', 'cljs', 'ex', 'exs', 'erl', 'hs', 'ml', 'fs', 'jl', 'dart', 'zig',
  'nim', 'sol', 'v', 'sv', 'vhd', 'asm', 's', 'awk', 'sed', 'pom', 'plist', 'strings', 'po',
  'desc', 'mod', 'sum', 'pbtxt', 'prototxt', 'cfgx', 'service', 'rules', 'gitmodules',
]);

/** Binary formats (skill-parser's text sniff falls back on this when a file has no NUL byte). Unchanged from lib/skill-parser.ts. */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'pdf', 'zip', 'gz', 'tar',
  'tgz', 'rar', '7z', 'mp3', 'mp4', 'wav', 'ogg', 'mov', 'avi', 'woff', 'woff2', 'ttf',
  'otf', 'eot', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'pyc',
]);

/**
 * Executables, installers and script formats a double-click can run. A WARNING
 * line in the viewer, never a block (owner decision: any file may be shared).
 */
export const DANGEROUS_EXTS: ReadonlySet<string> = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'hta', 'js', 'jar', 'apk', 'dmg', 'pkg', 'sh',
  'scr', 'lnk', 'reg', 'com', 'app',
  // same family
  'vbe', 'jse', 'wsf', 'psm1', 'cpl', 'msp', 'msix', 'appx', 'command', 'iso', 'deb', 'rpm',
]);

export function isDangerousExt(ext: string): boolean {
  return DANGEROUS_EXTS.has((ext ?? '').toLowerCase());
}

// ── Serving ──────────────────────────────────────────────────────────────────

export type ServeClass = 'inline-image' | 'inline-video' | 'inline-audio' | 'inline-pdf' | 'download';

/** How a stored file is served, by its KEY's extension. Anything outside the closed media set downloads. */
export function serveClassOf(keyExt: string): ServeClass {
  const ext = (keyExt ?? '').toLowerCase();
  if (RASTER_IMAGE_EXTS.has(ext)) return 'inline-image';
  if (INLINE_VIDEO_EXTS.has(ext)) return 'inline-video';
  if (INLINE_AUDIO_EXTS.has(ext)) return 'inline-audio';
  if (ext === 'pdf') return 'inline-pdf';
  return 'download';
}

/**
 * Whether navigating to a stored file SHOWS it (the inline media set) instead
 * of downloading it — by the key, like every other decision here. It is what
 * decides whether an "open in a new tab" control means anything: for every
 * other key the tab would only start a second download.
 */
export function opensInBrowser(storageKey: string): boolean {
  return serveClassOf(keyExtOf(storageKey)) !== 'download';
}

export function isTextExt(ext: string): boolean {
  return TEXT_EXTENSIONS.has((ext ?? '').toLowerCase());
}

/**
 * Content-Type for a key extension. The REAL type only for the inline media
 * classes; every text-like format (html, svg, xml, js…) is plain text; the rest
 * is opaque bytes. Pair it with `nosniff` — always.
 */
export function contentTypeFor(keyExt: string): string {
  const ext = (keyExt ?? '').toLowerCase();
  if (serveClassOf(ext) !== 'download') return INLINE_CONTENT_TYPES[ext];
  if (isTextExt(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

// ── Preview ──────────────────────────────────────────────────────────────────

export type PreviewClass = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'markdown' | 'json' | 'csv' | 'code' | 'text' | 'none';

const MARKDOWN_EXTS: ReadonlySet<string> = new Set(['md', 'markdown']);
const JSON_EXTS: ReadonlySet<string> = new Set(['json', 'geojson', 'ipynb']);
const CSV_EXTS: ReadonlySet<string> = new Set(['csv', 'tsv']);

/** highlight.js language for an extension, null when there is none worth asking for. */
export function languageForExt(ext: string): string | null {
  return EXT_LANG[(ext ?? '').toLowerCase()] ?? null;
}

/** Language for a file NAME — `Dockerfile` / `Makefile` carry theirs in the basename. */
export function languageForName(name: string): string | null {
  const base = baseName(name).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? languageForExt(base.slice(dot + 1)) : null;
}

/** Which renderer a stored file gets, by its KEY's extension. html / svg / xml are `code` — source only, never rendered. */
export function previewClassOf(keyExt: string): PreviewClass {
  const ext = (keyExt ?? '').toLowerCase();
  if (RASTER_IMAGE_EXTS.has(ext)) return 'image';
  if (INLINE_VIDEO_EXTS.has(ext)) return 'video';
  if (INLINE_AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (OFFICE_EXTS.has(ext)) return 'office';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (JSON_EXTS.has(ext)) return 'json';
  if (CSV_EXTS.has(ext)) return 'csv';
  if (languageForExt(ext)) return 'code';
  if (isTextExt(ext)) return 'text';
  return 'none';
}

/** Whether a preview class fetches the bytes and decodes them itself (NUL-sniffed, 1 MiB head). */
export function isTextPreviewClass(cls: PreviewClass): boolean {
  return cls === 'markdown' || cls === 'json' || cls === 'csv' || cls === 'code' || cls === 'text';
}

export interface FilePreviewPlan {
  cls: PreviewClass;
  /** The storage key's extension (the decision input). */
  keyExt: string;
  /** Highlight language for `code` / `text`; null when plain. */
  language: string | null;
  /**
   * The class was GUESSED from bytes-to-come, not known from the extension: an
   * extension-less upload (`Makefile`, `LICENSE`) stores as `.bin`, and the
   * viewer attempts a text preview that its NUL sniff turns into 不支持预览 for
   * real binaries. Badges stay silent for such files instead of promising.
   */
  sniffOnly: boolean;
}

/**
 * The preview plan for a stored file: the KEY decides; the display name is
 * consulted in exactly one case — a `bin` key whose name has NO extension at
 * all, where there is nothing else to go on and the only renderer offered is
 * the NUL-sniffed text view (plus a language for Dockerfile / Makefile).
 */
export function previewPlanFor(storageKey: string, name: string): FilePreviewPlan {
  const keyExt = keyExtOf(storageKey);
  // "No extension at all" = no dot past a leading one (`LICENSE`, `Makefile`);
  // `x.averyverylongext` fell back to bin for a reason and is not guessed at.
  if (keyExt === FALLBACK_KEY_EXT && !baseName(name).slice(1).includes('.')) {
    const language = languageForName(name);
    return { cls: language ? 'code' : 'text', keyExt, language, sniffOnly: true };
  }
  const cls = previewClassOf(keyExt);
  const language = cls === 'code' || cls === 'text' ? languageForExt(keyExt) : cls === 'json' ? 'json' : null;
  return { cls, keyExt, language, sniffOnly: false };
}

/** Display label for the EXT slot of a card: the name's (compound-aware) extension, else the key's unless it is the `bin` placeholder. */
export function displayExtOf(name: string, storageKey: string, mimeType?: string | null): string {
  const fromName = extOfName(name);
  if (fromName) return fromName;
  const fromKey = keyExtOf(storageKey);
  if (fromKey && fromKey !== FALLBACK_KEY_EXT) return fromKey;
  return extFromMime(mimeType);
}

// ── Upload-side sniffing (client) ────────────────────────────────────────────

/** MIME types the raster upload paths accept (zone `image` kind, /api/uploads/image). */
export const RASTER_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
export const INLINE_VIDEO_MIMES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
/** Spellings a raster file's name may carry while its MIME says jpeg/png/… (`.jfif` is a JPEG). */
const RASTER_NAME_EXTS: ReadonlySet<string> = new Set([...RASTER_IMAGE_EXTS, 'jpe', 'jfif', 'pjpeg', 'pjp', 'apng']);

function normalizedType(type: string | null | undefined): string {
  const t = (type ?? '').split(';')[0].trim().toLowerCase();
  return t === 'application/octet-stream' ? '' : t;
}

/**
 * A browser-renderable raster image, by MIME or — when the OS reported no type —
 * by extension. The name wins over a contradicting MIME (`x.ts` reported as
 * `video/mp2t` on some Windows registries is source code), and svg / heic / bmp /
 * tiff are never raster here: they go down the FILE path.
 */
export function isRasterImage(file: { name: string; type: string }): boolean {
  const type = normalizedType(file.type);
  const ext = lastExtOfName(file.name);
  if (type) return RASTER_IMAGE_MIMES.has(type) && (ext === '' || RASTER_NAME_EXTS.has(ext));
  return RASTER_IMAGE_EXTS.has(ext);
}

/** Same rule as isRasterImage for the three inline video containers. */
export function isInlineVideo(file: { name: string; type: string }): boolean {
  const type = normalizedType(file.type);
  const ext = lastExtOfName(file.name);
  if (type) return INLINE_VIDEO_MIMES.has(type) && (ext === '' || INLINE_VIDEO_EXTS.has(ext));
  return INLINE_VIDEO_EXTS.has(ext);
}

/**
 * The Content-Type an upload should DECLARE: the browser's own type when it
 * gave one, else the one its extension implies for the inline media set (the
 * image / video routes validate the header, and an empty type would 415 a real
 * `.png`), else octet-stream.
 */
export function uploadContentTypeFor(file: { name: string; type: string }): string {
  const type = normalizedType(file.type);
  if (type) return type;
  const ext = lastExtOfName(file.name);
  return serveClassOf(ext) !== 'download' ? INLINE_CONTENT_TYPES[ext] : 'application/octet-stream';
}
