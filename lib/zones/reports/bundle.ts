// 「聊天记录 → 报告」— 「一次上传整个文件夹 / zip」的文件识别规则（docs/contracts/reports.md §2a）。
//
// 用户从 WeLink 导出 / 用 welink-cli 拉下来的东西通常是一个目录：
//   加研思想院_0920-1015/
//     加研思想院_300.txt 或 page_001.txt 或 welink-cli.json  ← 聊天记录（welink-cli 页 / 合并数组 / 两种 TXT 版式）
//     加研思想院_图片附件清单.csv 或 images.json             ← 附件清单（可选，图片随文的前提）
//     加研思想院_图片附件/ *.png *.pdf                      ← 已下载的图片 / 文件
//     wl_names/<账号>.json 或 names.json                   ← 账号→姓名（welink-cli 输入才需要）
//     report.json（skill 产物，有它就走导入模式）
//
// **按内容识别，不按文件名**（owner 2026-10-20：「文件读取这里还要灵活一点，不要什么名字一定要保持一致」）：
// 每个文本类文件带着开头几 KB（`head`）进来，`sniffText` 判断它是 welink JSON（页 / 数组）、TXT 记录、清单、
// 姓名表还是别的；扩展名只做兜底（没有 head 时）。所有 welink JSON 候选都会被合并（按 msgId 去重）。
// 本文件不碰 node API：向导（浏览器）和流水线（服务端解 zip）用同一份规则，向导显示的识别结果就是服务端的结果。

export interface BundleFile {
  /** zip / 文件夹内的相对路径（正斜杠）。 */
  path: string;
  size: number;
  /** 文本类文件的开头（≤ HEAD_BYTES），由调用方读；没有就只按扩展名判断。 */
  head?: string;
}

export type TextKind = 'welink_json' | 'welink_txt' | 'welink_csv' | 'manifest' | 'names' | 'report_json' | 'other';

export interface BundlePlan<T extends BundleFile = BundleFile> {
  /**
   * 聊天记录候选：welink JSON（可多份，服务端合并）/ TXT / CSV 记录——服务端会逐个真解析，谁解析出的消息多用谁。
   * 内容没认出来的 json / txt / csv / log / md 也排在后面（guess: true）：解析器认得就用，认不得再交给模型推断格式，
   * 最后才报错——不因为名字 / 开头不像就把文件筛掉。
   */
  sources: { file: T; kind: 'welink_json' | 'welink_txt' | 'welink_csv'; guess?: boolean }[];
  manifest: T | null;
  importJson: T | null;
  /** names.json / wl_names/*.json / 内容像 search person 输出的 json。 */
  names: T[];
  assets: { file: T; kind: 'image' | 'file' }[];
  /** 跳过的文件与原因（向导展示给用户）。 */
  ignored: { file: T; reason: string }[];
}

/** 调用方读 head 时取这么多字节就够判断了。 */
export const HEAD_BYTES = 8 * 1024;
/** 超过这个大小的文本文件不读 head（向导里是浏览器内存；服务端也没必要）。 */
export const MAX_SNIFF_BYTES = 200 * 1024 * 1024;

export const BUNDLE_IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
const TEXT_EXT_RE = /\.(txt|json|csv|log|md)$/i;
const SKIP_DIR_RE = /(^|\/)(__MACOSX|\.git|node_modules|work)(\/|$)/;
const SKIP_NAME = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const SKILL_OUTPUT_NAMES = new Set(['report.html', 'report.md', 'digest.md', 'stats.json', 'links.json', 'messages.json', 'themes.json', 'overview.json', 'recap.json']);
const MANIFEST_HINT_RE = /清单|manifest|attach|image|图片/i;
// 行头：`[2026-09-20 07:08:22] 姓名（账号）`，括号 / 秒 / 分隔符都可省；或 `姓名（账号） 2026-09-20 07:08`
const TXT_HEAD_RE = /^[[【]?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?[\]】]?\s*[^,\n]{1,40}?[（(][A-Za-z0-9_.@-]+[)）]|^[^,\n]{1,40}?[（(][A-Za-z0-9_.@-]+[)）]\s+[[【]?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}/m;
const TXT_DAY_RE = /^(?:#{2,}|={2,}|-{2,}|[[【])?\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*(?:#{2,}|={2,}|-{2,}|[\]】])?\s*$/m;
const TXT_TIME_RE = /^[[【]?\d{1,2}:\d{2}(?::\d{2})?[\]】]?\s*\S/m;

export function bundleBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 文本类扩展名（会被读 head 的那些）。 */
export function isTextLike(path: string): boolean {
  const base = bundleBasename(path);
  return TEXT_EXT_RE.test(base) || !base.includes('.');
}

/**
 * 看开头几 KB 判断一个文本文件是什么。welink JSON 的特征是消息对象里的 msgId + serverSendTime
 * （页：respData.chatInfo；数组：[{msgId…}]）；清单看表头 / fname+url；姓名表看 search_cli_person 或
 * 纯 {账号: 姓名}；TXT 记录看两种版式的行头。
 */
export function sniffText(head: string, path = ''): TextKind {
  let t = head.replace(/^\uFEFF/, '').replace(/\u001b\[[0-9;]*m/g, '').trimStart();
  const base = bundleBasename(path).toLowerCase();
  if (!t) return 'other';
  // welink-cli 的输出常带一两行 CLI 文字再接 JSON：JSON 开头在前 200 字符内就从那里看
  const j = t.search(/[[{]\s*["{[]/); // `{"` / `[{` / `[[`：JSON 的开头，`[2026-09-20 …]` 这种 TXT 行头不算
  if (j > 0 && j < 200) t = t.slice(j);
  if (base === 'report.json' || (t.startsWith('{') && /"schemaVersion"\s*:\s*1/.test(t) && /"themes"/.test(t))) return 'report_json';
  if (t.startsWith('{') || t.startsWith('[')) {
    if (/"search_cli_person"/.test(t)) return 'names';
    if (/"msgId"\s*:/.test(t) && /"serverSendTime"\s*:/.test(t)) return 'welink_json';
    if (/"chatInfo"\s*:/.test(t)) return 'welink_json';
    if (t.startsWith('[') && /"fname"\s*:/.test(t) && /"url"\s*:/.test(t)) return 'manifest';
    if (base === 'names.json' || (t.startsWith('{') && /^\{\s*"[a-z]\d{6,10}"\s*:\s*"/i.test(t))) return 'names';
    return 'other';
  }
  // CSV 先看表头（第一行），再看 TXT 行头——CSV 的数据行也以时间开头
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  if (/,/.test(firstLine)) {
    if (/文件名|fname/.test(firstLine) && /(外链|提取码|url|code)/.test(firstLine)) return 'manifest';
    if (/(时间|time|date)/i.test(firstLine) && /(内容|content|text|message|msg|body)/i.test(firstLine)) return 'welink_csv';
  }
  if (TXT_HEAD_RE.test(t) || (TXT_DAY_RE.test(t) && TXT_TIME_RE.test(t))) return 'welink_txt';
  return 'other';
}

/** 把一组文件按角色分类；输入顺序无关，结果是确定性的。 */
export function planReportBundle<T extends BundleFile>(files: T[]): BundlePlan<T> {
  const plan: BundlePlan<T> = { sources: [], manifest: null, importJson: null, names: [], assets: [], ignored: [] };
  const csvCandidates: T[] = [];
  const csvRecords: T[] = [];
  const txts: T[] = [];
  const guessJson: T[] = [];
  const rest: T[] = [];

  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = f.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    const base = bundleBasename(path);
    const lower = base.toLowerCase();
    if (!base || base.startsWith('.') || SKIP_NAME.has(lower) || SKIP_DIR_RE.test(path)) {
      plan.ignored.push({ file: f, reason: 'system' });
      continue;
    }
    if (f.size <= 0) {
      plan.ignored.push({ file: f, reason: 'empty' });
      continue;
    }
    if (lower.endsWith('.zip')) {
      plan.ignored.push({ file: f, reason: 'nested_zip' });
      continue;
    }
    if (/(^|\/)wl_names\//i.test(path) && lower.endsWith('.json')) {
      plan.names.push(f);
      continue;
    }
    // 文本类：按内容
    if (isTextLike(path) && f.head !== undefined) {
      const kind = sniffText(f.head, path);
      if (kind === 'report_json') {
        if (!plan.importJson || f.size > plan.importJson.size) plan.importJson = f;
        continue;
      }
      if (kind === 'welink_json') {
        plan.sources.push({ file: f, kind });
        continue;
      }
      if (kind === 'welink_txt') {
        txts.push(f);
        continue;
      }
      if (kind === 'welink_csv') {
        csvRecords.push(f);
        continue;
      }
      if (kind === 'names') {
        plan.names.push(f);
        continue;
      }
      if (kind === 'manifest') {
        csvCandidates.push(f);
        continue;
      }
      // 内容认不出来的文本：skill 的中间产物直接忽略；其余 json 排进候选末尾（服务端真解析一遍，解析不出再丢）；
      // csv 还可能是清单（表头不标准）；其余当附件文件、同时也是候选
      if (SKILL_OUTPUT_NAMES.has(lower)) {
        plan.ignored.push({ file: f, reason: 'skill_output' });
        continue;
      }
      if (lower.endsWith('.json')) {
        guessJson.push(f);
        continue;
      }
      if (lower.endsWith('.csv')) {
        csvCandidates.push(f);
        continue;
      }
      rest.push(f);
      continue;
    }
    // 没有 head（调用方没读）：退回扩展名规则
    if (lower === 'report.json') {
      plan.importJson = f;
      continue;
    }
    if (lower === 'names.json') {
      plan.names.push(f);
      continue;
    }
    if (SKILL_OUTPUT_NAMES.has(lower)) {
      plan.ignored.push({ file: f, reason: 'skill_output' });
      continue;
    }
    if (lower.endsWith('.txt')) txts.push(f);
    else if (lower.endsWith('.json')) plan.sources.push({ file: f, kind: 'welink_json' });
    else if (lower.endsWith('.csv')) csvCandidates.push(f);
    else rest.push(f);
  }

  // 清单：内容认出来的优先（csvCandidates 里 sniff 为 manifest 的），再按名字提示，再第一个；其余 csv 当附件
  if (csvCandidates.length) {
    const byContent = csvCandidates.find((f) => f.head !== undefined && sniffText(f.head, f.path) === 'manifest');
    const hinted = csvCandidates.find((f) => MANIFEST_HINT_RE.test(bundleBasename(f.path)));
    plan.manifest = byContent ?? hinted ?? csvCandidates[0];
    for (const f of csvCandidates) if (f !== plan.manifest) plan.assets.push({ file: f, kind: 'file' });
  }

  // 记录候选：认出来的在前——JSON 全部（服务端合并去重）、TXT 按大小、CSV 记录；
  // 后面跟 guess：内容没认出的 json，以及每个 .txt / .log / .md / 非清单 csv——服务端逐个真解析，谁消息多用谁
  txts.sort((a, b) => b.size - a.size);
  for (const f of txts) plan.sources.push({ file: f, kind: 'welink_txt' });
  for (const f of csvRecords) plan.sources.push({ file: f, kind: 'welink_csv' });
  const bySize = (a: T, b: T) => b.size - a.size;
  for (const f of [...guessJson].sort(bySize)) plan.sources.push({ file: f, kind: 'welink_json', guess: true });
  for (const f of rest.filter((x) => /\.(txt|log|md)$/i.test(x.path) || !bundleBasename(x.path).includes('.')).sort(bySize)) plan.sources.push({ file: f, kind: 'welink_txt', guess: true });
  for (const f of csvCandidates) if (f !== plan.manifest) plan.sources.push({ file: f, kind: 'welink_csv', guess: true });

  for (const f of rest) plan.assets.push({ file: f, kind: BUNDLE_IMAGE_RE.test(f.path) ? 'image' : 'file' });
  plan.assets.sort((a, b) => a.file.path.localeCompare(b.file.path));
  return plan;
}

/** 有没有东西可以当聊天记录（含 guess 候选——它们会在服务端真解析）。 */
export function bundleHasChat(plan: BundlePlan): boolean {
  return plan.sources.length > 0 || !!plan.importJson;
}

/** 内容认出来的聊天记录候选（向导展示用；guess 的另算）。 */
export function sureSources<T extends BundleFile>(plan: BundlePlan<T>): BundlePlan<T>['sources'] {
  return plan.sources.filter((s) => !s.guess);
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function jsonBody(text: string): unknown {
  const t = stripAnsi(text).replace(/^\uFEFF/, '');
  const a = Math.min(...[t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0));
  if (!Number.isFinite(a)) return null;
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (b < a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1)) as unknown;
  } catch {
    return null;
  }
}

/** 所有 welink JSON 候选（页 / 合并数组，混着也行）→ 一个按 msgId 去重的消息数组（JSON 字符串）。 */
export function mergeWelinkPages(texts: string[]): string {
  const seen = new Map<string, unknown>();
  for (const text of texts) {
    const o = jsonBody(text) as { respData?: { chatInfo?: unknown[] }; chatInfo?: unknown[] } | unknown[] | null;
    const list: unknown[] = Array.isArray(o) ? o : (o?.respData?.chatInfo ?? o?.chatInfo ?? []);
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const id = String((m as { msgId?: unknown }).msgId ?? `_${seen.size}`);
      if (!seen.has(id)) seen.set(id, m);
    }
  }
  return JSON.stringify([...seen.values()]);
}

/** names.json（{账号: 姓名}）/ wl_names/<账号>.json（`welink-cli search person` 输出）→ 账号→姓名。 */
export function namesFromBundle(entries: { path: string; text: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const base = bundleBasename(e.path).toLowerCase();
    const o = jsonBody(e.text);
    if (!o || typeof o !== 'object') continue;
    const people = (o as { search_cli_person?: { data?: unknown[] } }).search_cli_person?.data;
    if (Array.isArray(people)) {
      const acc = base.replace(/\.json$/, '');
      const arr = people as { w3account?: unknown; chineseName?: unknown }[];
      const hit = arr.find((x) => String(x.w3account ?? '').toLowerCase() === acc) ?? arr[0];
      if (hit && typeof hit.chineseName === 'string') out[String(hit.w3account ?? acc).toLowerCase()] = hit.chineseName;
      continue;
    }
    if (!Array.isArray(o)) for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}
