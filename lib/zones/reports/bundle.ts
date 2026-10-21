// 版块报告 — 「一次上传整个文件夹 / zip」的文件识别规则（docs/contracts/reports.md §2a）。
//
// 用户从 WeLink 导出 / 用 welink-cli 拉下来的东西通常是一个目录：
//   加研思想院_9月/
//     加研思想院_300.txt                 ← 聊天记录（WeLink 导出 TXT）
//     或 page1.json page2.json …          ← welink-cli 分页 JSON（合并后再解析）
//     加研思想院_9月_图片附件清单.csv       ← 附件清单（可选，图片随文的前提）
//     加研思想院_9月_图片附件/ *.png *.pdf  ← 已下载的图片 / 文件
//     wl_names/<账号>.json 或 names.json   ← 账号→姓名（welink-cli 输入才需要）
//     report.json（skill 产物，有它就走导入模式）
// 本文件只做「按文件名 / 大小分类」，不读内容、不碰 node API，所以向导（浏览器）和
// 流水线（服务端解 zip）用的是同一份规则——用户在向导里看到的识别结果就是服务端的结果。

export interface BundleFile {
  /** zip / 文件夹内的相对路径（正斜杠）。 */
  path: string;
  size: number;
}

export interface BundlePlan<T extends BundleFile = BundleFile> {
  /** 聊天记录：TXT，或单个 welink-cli JSON。 */
  source: T | null;
  /** welink-cli 分页 JSON（≥ 2 个时按 msgId 去重合并成一个数组）。 */
  sourcePages: T[];
  manifest: T | null;
  importJson: T | null;
  /** names.json / wl_names/*.json。 */
  names: T[];
  assets: { file: T; kind: 'image' | 'file' }[];
  /** 跳过的文件与原因（向导展示给用户）。 */
  ignored: { file: T; reason: string }[];
}

export const BUNDLE_IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
const SKIP_DIR_RE = /(^|\/)(__MACOSX|\.git|node_modules|work)(\/|$)/;
const SKIP_NAME = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const SKILL_OUTPUT_NAMES = new Set(['report.html', 'report.md', 'digest.md', 'stats.json', 'links.json', 'messages.json', 'themes.json', 'overview.json', 'recap.json']);
const MANIFEST_HINT_RE = /清单|manifest|attach|image|图片/i;
/** welink-monthly-report 契约的合并消息 JSON（`*_msgs.json`）：比 TXT 全（附件协议块 / 引用卡片都在），有它就优先。 */
const MSGS_JSON_RE = /_msgs\.json$/i;

export function bundleBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 把一组文件按角色分类；输入顺序无关，结果是确定性的。 */
export function planReportBundle<T extends BundleFile>(files: T[]): BundlePlan<T> {
  const plan: BundlePlan<T> = { source: null, sourcePages: [], manifest: null, importJson: null, names: [], assets: [], ignored: [] };
  const txts: T[] = [];
  const jsons: T[] = [];
  const csvs: T[] = [];
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
    if (lower === 'report.json') {
      if (!plan.importJson || f.size > plan.importJson.size) plan.importJson = f;
      continue;
    }
    if (lower === 'names.json' || (/(^|\/)wl_names\//i.test(path) && lower.endsWith('.json'))) {
      plan.names.push(f);
      continue;
    }
    if (SKILL_OUTPUT_NAMES.has(lower)) {
      plan.ignored.push({ file: f, reason: 'skill_output' });
      continue;
    }
    if (lower.endsWith('.txt')) txts.push(f);
    else if (lower.endsWith('.json')) jsons.push(f);
    else if (lower.endsWith('.csv')) csvs.push(f);
    else rest.push(f);
  }

  // 聊天记录：`*_msgs.json` 最优先（welink-cli 合并产物，信息最全）；其次最大的 TXT；都没有时把 JSON 当 welink-cli 页
  const msgsJson = jsons.filter((f) => MSGS_JSON_RE.test(bundleBasename(f.path))).sort((a, b) => b.size - a.size)[0];
  if (msgsJson) {
    plan.source = msgsJson;
    for (const f of jsons) if (f !== msgsJson) plan.ignored.push({ file: f, reason: 'json_with_msgs' });
    for (const f of txts) plan.ignored.push({ file: f, reason: 'txt_with_msgs' });
  } else if (txts.length) {
    txts.sort((a, b) => b.size - a.size);
    plan.source = txts[0];
    for (const f of txts.slice(1)) plan.assets.push({ file: f, kind: 'file' });
    for (const f of jsons) plan.ignored.push({ file: f, reason: 'json_with_txt' });
  } else if (jsons.length === 1) {
    plan.source = jsons[0];
  } else if (jsons.length > 1) {
    plan.sourcePages = jsons;
  }

  // 清单：名字像清单的优先，否则第一个 CSV；其余 CSV 当附件
  if (csvs.length) {
    const hinted = csvs.find((f) => MANIFEST_HINT_RE.test(bundleBasename(f.path)));
    plan.manifest = hinted ?? csvs[0];
    for (const f of csvs) if (f !== plan.manifest) plan.assets.push({ file: f, kind: 'file' });
  }

  for (const f of rest) plan.assets.push({ file: f, kind: BUNDLE_IMAGE_RE.test(f.path) ? 'image' : 'file' });
  plan.assets.sort((a, b) => a.file.path.localeCompare(b.file.path));
  return plan;
}

export function bundleHasChat(plan: BundlePlan): boolean {
  return !!plan.source || plan.sourcePages.length > 0 || !!plan.importJson;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function jsonBody(text: string): unknown {
  const t = stripAnsi(text);
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1)) as unknown;
  } catch {
    return null;
  }
}

/** welink-cli 分页输出 → 一个按 msgId 去重的消息数组（JSON 字符串），交给 parseChat。 */
export function mergeWelinkPages(texts: string[]): string {
  const seen = new Map<string, unknown>();
  for (const text of texts) {
    const o = jsonBody(text) as { respData?: { chatInfo?: unknown[] }; chatInfo?: unknown[] } | unknown[] | null;
    const list: unknown[] = Array.isArray(o) ? o : (o?.respData?.chatInfo ?? o?.chatInfo ?? []);
    for (const m of list) {
      const id = String((m as { msgId?: unknown })?.msgId ?? seen.size);
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
    if (base === 'names.json') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'string') out[k.toLowerCase()] = v;
      continue;
    }
    const acc = base.replace(/\.json$/, '');
    const arr = ((o as { search_cli_person?: { data?: unknown[] } }).search_cli_person?.data ?? []) as { w3account?: unknown; chineseName?: unknown }[];
    const hit = arr.find((x) => String(x.w3account ?? '').toLowerCase() === acc) ?? arr[0];
    if (hit && typeof hit.chineseName === 'string') out[acc] = hit.chineseName;
  }
  return out;
}
