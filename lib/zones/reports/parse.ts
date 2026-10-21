// 版块报告 — 聊天记录解析（与 skill scripts/parse-chat.mjs 同规则，输入改为字符串）。
//
// 支持：A. WeLink 导出 TXT（"[YYYY-MM-DD HH:mm:ss] 姓名（账号）" + 正文行）
//      B. welink-cli 合并 JSON（数组）/ 单页 {respData:{chatInfo:[…]}}
// 附件清单 CSV（时间,发送人,姓名,类型,文件名,大小KB,外链,提取码,是否已下载）把 "[图片/附件]"
// 占位对到文件名；上传的 assets 再按文件名对到 ZoneReportAsset.key。
// 纯函数、无 IO：tests/zone-reports-parse.test.ts 直接跑。

import type { ParsedAttachment, ParsedChat, ParsedMessage, RosterEntry } from './schema';

// TXT 版式（都是 agent 从 welink-cli 分页 JSON 转出来的；reference/welink-format.md §1），尽量宽：
//   A1 `[YYYY-MM-DD HH:mm:ss] 姓名（账号）`（方括号 / 【】/ 不带括号都行；秒可省；`-` `/` `.` 都认；`· 类型` 可选）
//   A2 `#### YYYY-MM-DD ####` 日头（也认 ==== / ---- / 【】/ [] 包着的日期）+ `[HH:mm:ss] 姓名（账号）· 类型`
//   A3 `姓名（账号） YYYY-MM-DD HH:mm:ss`（谁在前、时间在后）
const DATE_PART = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?`;
const TIME_PART = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const WHO_PART = String.raw`(.+?)\s*[（(]([A-Za-z0-9_.@-]+)[）)]`;
const TYPE_PART = String.raw`(?:\s*(?:[·•|]\s*|<)([^<>\s]+)>?)?`; // `· 文本` / `| 文本` / `<文本>`
const HEAD_RE = new RegExp(String.raw`^[\[【]?(${DATE_PART})[\]】]?\s*${WHO_PART}${TYPE_PART}\s*[:：]?\s*$`);
const HEAD_WHO_FIRST_RE = new RegExp(String.raw`^${WHO_PART}\s+[\[【]?(${DATE_PART})[\]】]?${TYPE_PART}\s*[:：]?\s*$`);
const HEAD_TIME_RE = new RegExp(String.raw`^[\[【]?(${TIME_PART})[\]】]?\s*${WHO_PART}${TYPE_PART}\s*[:：]?\s*$`);
const DAY_RE = /^(?:#{2,}|={2,}|-{2,}|[[【])?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s*星期[一二三四五六日天]|\s*周[一二三四五六日天])?\s*(?:#{2,}|={2,}|-{2,}|[\]】])?\s*$/;
const TXT_TYPE: Record<string, string> = { 文本: 'TEXT_MSG', 图片: 'PICTURE_MSG', 图文: 'IMAGESPAN_MSG', 文件: 'FILE_MSG', 语音: 'VOICE_MSG', 视频: 'VIDEO_MSG', 卡片: 'CARD_MSG', 分享: 'SHAREING_MSG' };
const UM_RE = /\/:um_begin\{([^}]*)\}\/:um_end/g;
const PLACEHOLDER = '[图片/附件]';
export const URL_RE = /https?:\/\/[^\s"'<>（）()，。；！？《》「」【】\\|}]+/g;
const EMOJI_CODE_RE = /⁠?\/[A-Z]{2}\b/g;
const BRACKET_EMOJI_RE = /\[(火箭|鼓掌|强|赞|OK|握手|玫瑰|咖啡|太阳|微笑|害羞|呲牙|笑哭|大笑|加油|666)\]/g;
const ACK_RE = /^(ok+|okok|好的?|好|收到|谢谢|感谢|对|是|嗯+|哈+|cool|nice|赞|👍|666|可以|行|了解|学习了|厉害|牛|哇|哦+|啊+|嗯嗯|哈哈哈*)[!！。.~～]*$/i;

const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const fmtTime = (d: Date) => `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
export const fmtMMDD = (d: Date) => `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function parseLocalTime(s: string): Date | null {
  const t = s.trim();
  // 2026-09-20 07:08:22 / 2026-09-20T07:08 / 2026/09/20 07:08:22 / 2026-9-20 7:08
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // 纯数字：毫秒 / 秒时间戳
  if (/^\d{12,13}$/.test(t)) return new Date(+t);
  if (/^\d{9,10}$/.test(t)) return new Date(+t * 1000);
  return null;
}

/** 任何像时间的值 → 毫秒（数字毫秒 / 秒、ISO、"YYYY-MM-DD HH:mm:ss"）；认不出 → NaN。 */
export function anyTimeToMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? v : v > 1e8 ? v * 1000 : NaN;
  if (typeof v === 'string') {
    const d = parseLocalTime(v);
    if (d) return d.getTime();
    const iso = Date.parse(v);
    return Number.isFinite(iso) ? iso : NaN;
  }
  return NaN;
}

export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function stripEmojiCodes(text: string): string {
  return (text || '')
    .replace(EMOJI_CODE_RE, ' ')
    .replace(BRACKET_EMOJI_RE, ' ')
    .replace(/⁠/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，,、；;。]+\s*/, '');
}

export function isNoiseText(text: string): boolean {
  const t = stripEmojiCodes(text);
  if (!t) return true;
  const noAt = t.replace(/@\S+/g, '').trim();
  if (!noAt) return true;
  return noAt.length <= 6 && ACK_RE.test(noAt);
}

export interface RawMessage {
  msgId: string | null;
  ts: number;
  account: string;
  name: string;
  contentType: unknown;
  content: string;
}

function parseTxt(text: string): RawMessage[] {
  const lines = text.split(/\r?\n/);
  const out: RawMessage[] = [];
  let cur: (RawMessage & { lines: string[] }) | null = null;
  const finish = (c: RawMessage & { lines: string[] }) => {
    while (c.lines.length && !c.lines[c.lines.length - 1].trim()) c.lines.pop();
    while (c.lines.length && !c.lines[0].trim()) c.lines.shift();
    const { lines: ls, ...rest } = c;
    out.push({ ...rest, content: ls.join('\n') });
  };
  let day: string | null = null;
  for (const line of lines) {
    const dm = DAY_RE.exec(line);
    if (dm) {
      day = dm[1];
      continue;
    }
    // 三种行头：[时间] 谁 / 谁 [时间] / （有日头时）[时:分:秒] 谁
    let stamp: string | null = null;
    let name = '';
    let account = '';
    let type: string | undefined;
    let m = line.length <= 400 ? HEAD_RE.exec(line) : null;
    if (m) [stamp, name, account, type] = [m[1], m[2], m[3], m[4]];
    else if ((m = line.length <= 400 ? HEAD_WHO_FIRST_RE.exec(line) : null)) [name, account, stamp, type] = [m[1], m[2], m[3], m[4]];
    else if (day && (m = line.length <= 400 ? HEAD_TIME_RE.exec(line) : null)) [stamp, name, account, type] = [`${day} ${m[1]}`, m[2], m[3], m[4]];
    if (m && stamp) {
      const d = parseLocalTime(stamp);
      if (d) {
        if (cur) finish(cur);
        cur = { msgId: null, ts: d.getTime(), account: account.toLowerCase(), name: name.trim(), contentType: type ? (TXT_TYPE[type] ?? type) : null, lines: [], content: '' };
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) finish(cur);
  return out;
}

const pick = (m: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (m[k] !== undefined && m[k] !== null && m[k] !== '') return m[k];
  return undefined;
};

/**
 * 一条消息对象 → RawMessage。字段名尽量宽：welink-cli 原样（msgId / sender / serverSendTime / contentType / content），
 * 也认 agent 自己整理过的形状（time / account / name / type / text…）。认不出时间的条目后面会被过滤掉。
 */
function fromWelinkCli(m: Record<string, unknown>): RawMessage {
  const ts = anyTimeToMs(pick(m, ['serverSendTime', 'sendTime', 'timestamp', 'ts', 'time', 'date', 'createdAt', 'created_at', '时间']));
  const id = pick(m, ['msgId', 'messageId', 'messageID', 'id']);
  const account = pick(m, ['sender', 'account', 'senderAccount', 'from', 'w3account', 'userId', '发送人', '账号']);
  const name = pick(m, ['nameZH', 'senderName', 'name', 'displayName', 'nickname', '姓名', '发送人姓名']);
  const content = pick(m, ['content', 'text', 'msg', 'message', 'body', '内容']);
  return {
    msgId: id != null ? String(id) : null,
    ts,
    account: String(account ?? '').toLowerCase(),
    name: String(name ?? ''),
    contentType: pick(m, ['contentType', 'type', 'msgType', '类型']) ?? null,
    content: typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content),
  };
}

/** 在任意 JSON 里找"消息数组"：顶层数组、respData.chatInfo、chatInfo、messages / data / items / list / records，或任何一个值是消息数组的键。 */
function findMessageArray(o: unknown, depth = 0): Record<string, unknown>[] {
  if (Array.isArray(o)) {
    const objs = o.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
    // 数组元素里有时间 + 内容字样的才算消息数组
    const looks = objs.slice(0, 5).some((x) => pick(x, ['serverSendTime', 'sendTime', 'timestamp', 'ts', 'time', 'date', '时间']) !== undefined && pick(x, ['content', 'text', 'msg', 'message', 'body', '内容']) !== undefined);
    if (looks) return objs;
    // 分页数组：[{respData:{chatInfo}} , …] → 拼起来
    if (depth < 3) {
      const merged: Record<string, unknown>[] = [];
      for (const x of objs) merged.push(...findMessageArray(x, depth + 1));
      if (merged.length) return merged;
    }
    return [];
  }
  if (o && typeof o === 'object' && depth < 4) {
    const obj = o as Record<string, unknown>;
    for (const k of ['chatInfo', 'messages', 'data', 'items', 'list', 'records', 'msgs', 'result']) {
      if (obj[k] !== undefined) {
        const hit = findMessageArray(obj[k], depth + 1);
        if (hit.length) return hit;
      }
    }
    if (obj.respData !== undefined) {
      const hit = findMessageArray(obj.respData, depth + 1);
      if (hit.length) return hit;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const hit = findMessageArray(v, depth + 1);
        if (hit.length) return hit;
      }
    }
  }
  return [];
}

function parseJsonInput(text: string): RawMessage[] {
  // 允许前面有几行 CLI 文字
  const a = Math.min(...[text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0));
  const b = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  const o = JSON.parse(text.slice(Number.isFinite(a) ? a : 0, b + 1)) as unknown;
  const seen = new Map<string, RawMessage>();
  for (const item of findMessageArray(o)) {
    const r = fromWelinkCli(item);
    const key = r.msgId ?? `${r.ts}:${r.account}:${r.content.slice(0, 40)}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

function parseUm(block: string): ParsedAttachment {
  const parts = block.split('|');
  const tail = (parts[5] || '').split(';');
  return {
    url: parts[0] || null,
    kind: (parts[1] || '').toLowerCase() === 'file' ? 'file' : 'image',
    size: parseInt(parts[2] || '0', 10) || 0,
    file: parts[3] || '',
    code: tail[tail.length - 1] || null,
    present: null,
  };
}

function normalize(m: RawMessage, idx: number, nameMap: Map<string, string>): ParsedMessage {
  const d = new Date(m.ts);
  const base: ParsedMessage = {
    id: `m${idx + 1}`,
    msgId: m.msgId,
    time: fmtTime(d),
    ts: m.ts,
    date: fmtDate(d),
    account: m.account,
    name: nameMap.get(m.account) || m.name || m.account,
    type: 'text',
    text: '',
    raw: m.content,
    links: [],
    mentions: [],
    replyTo: null,
    attachments: [],
    hasAttachmentPlaceholder: false,
  };
  let content = m.content.trim();
  if (content.startsWith('{')) {
    let o: Record<string, unknown> | null = null;
    try {
      o = JSON.parse(content) as Record<string, unknown>;
    } catch {
      o = null;
    }
    if (o && typeof o === 'object') {
      const ctx = (o.cardContext ?? {}) as Record<string, unknown>;
      const replyMsg = ctx.replyMsg as Record<string, unknown> | undefined;
      if (replyMsg) {
        base.type = 'reply';
        base.text = stripEmojiCodes(String(replyMsg.content ?? ''));
        const pre = (ctx.preMsg ?? {}) as Record<string, unknown>;
        base.replyTo = {
          id: null,
          account: String(pre.sender ?? '').toLowerCase(),
          name: String(pre.nameZH ?? pre.nameEN ?? ''),
          content: String(pre.content ?? '').slice(0, 200),
          messageID: pre.messageID ? String(pre.messageID) : null,
        };
        if (base.text.includes(PLACEHOLDER)) base.hasAttachmentPlaceholder = true;
        if (isNoiseText(base.text.split(PLACEHOLDER).join('')) && !base.hasAttachmentPlaceholder) base.type = 'noise';
      } else {
        const url = String(ctx.sourceUrl ?? o.sourceUrl ?? '');
        const title = String(o.title ?? '').trim();
        const digest = String(o.digest ?? '').trim();
        base.type = 'link_card';
        base.cardTitle = title || null;
        base.cardDigest = digest && digest !== url ? digest.slice(0, 300) : null;
        base.cardSource = (o.source as string | undefined) ?? (ctx.source as string | undefined) ?? null;
        base.text = title || (digest && !/^https?:\/\//.test(digest) ? digest.slice(0, 200) : '') || url;
        if (url) base.links.push({ url, host: hostOf(url), title: title || null });
      }
      content = base.text;
    }
  }
  if (base.type === 'text') {
    const ums = [...content.matchAll(UM_RE)].map((x) => parseUm(x[1]));
    for (const u of ums) if (u.url && /clouddrive\.huawei\.com\/f\//.test(u.url)) base.attachments.push({ ...u, msgId: base.id });
    content = content.replace(UM_RE, ` ${PLACEHOLDER} `);
    if (content.includes(PLACEHOLDER)) base.hasAttachmentPlaceholder = true;
    base.text = stripEmojiCodes(content.split(PLACEHOLDER).join(' ').trim());
    if (!base.text && (base.attachments.length || base.hasAttachmentPlaceholder)) {
      base.type = base.attachments.some((a) => a.kind === 'file') ? 'file' : 'image';
    } else if (isNoiseText(base.text)) {
      base.type = 'noise';
    }
  }
  for (const u of extractUrls(base.type === 'link_card' ? '' : base.raw)) {
    if (!base.links.some((l) => l.url === u)) base.links.push({ url: u, host: hostOf(u), title: null });
  }
  const mentionSrc = base.type === 'link_card' ? '' : base.text;
  base.mentions = [...new Set([...mentionSrc.matchAll(/@([^\s@，,。：:/\\]{1,20})/g)].map((x) => x[1]).filter((x) => x !== '所有人'))];
  return base;
}

export interface ManifestRow {
  time: string;
  ts: number;
  account: string;
  name: string;
  kind: 'image' | 'file';
  file: string;
  size: number;
  url: string;
  code: string;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 图片附件清单 CSV（welink-monthly-report 契约）或 *_images.json。 */
export function parseManifest(text: string): ManifestRow[] {
  const t = text.replace(/^\uFEFF/, '').trim();
  if (t.startsWith('[')) {
    const arr = JSON.parse(t) as Record<string, unknown>[];
    return arr
      .map((i) => ({
        time: String(i.time ?? ''),
        ts: parseLocalTime(String(i.time ?? ''))?.getTime() ?? NaN,
        account: String(i.sender ?? i.account ?? '').toLowerCase(),
        name: String(i.name ?? ''),
        kind: (String(i.kind ?? '').toLowerCase() === 'file' ? 'file' : 'image') as 'image' | 'file',
        file: String(i.fname ?? i.file ?? ''),
        size: Number(i.size ?? 0),
        url: String(i.url ?? ''),
        code: String(i.code ?? ''),
      }))
      .filter((r) => r.file);
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsv(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iTime = col('时间'), iAcc = col('发送人'), iName = col('姓名'), iKind = col('类型'), iFile = col('文件名'), iSize = col('大小KB'), iUrl = col('外链'), iCode = col('提取码');
  if (iFile < 0) return [];
  return lines
    .slice(1)
    .map((l) => {
      const c = splitCsv(l);
      const time = c[iTime] ?? '';
      return {
        time,
        ts: parseLocalTime(time)?.getTime() ?? NaN,
        account: String(c[iAcc] ?? '').toLowerCase(),
        name: c[iName] ?? '',
        kind: (String(c[iKind] ?? '').toLowerCase() === 'file' ? 'file' : 'image') as 'image' | 'file',
        file: c[iFile] ?? '',
        size: Math.round((parseFloat(c[iSize] ?? '0') || 0) * 1024),
        url: c[iUrl] ?? '',
        code: c[iCode] ?? '',
      };
    })
    .filter((r) => r.file);
}

/**
 * CSV 形式的消息记录（agent 自己导的表：时间 / 发送人 / 姓名 / 类型 / 内容 之类的表头，中英文都认）。
 * 没有「时间 + 内容」两列就不算。
 */
function parseCsvRecords(text: string): RawMessage[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iTime = col('时间', 'time', 'date', 'sendtime', 'timestamp');
  const iContent = col('内容', 'content', 'text', 'message', 'msg', 'body');
  if (iTime < 0 || iContent < 0) return [];
  const iAcc = col('账号', '发送人', 'sender', 'account', 'from', 'w3');
  const iName = col('姓名', 'name', '昵称');
  const iType = col('类型', 'type');
  const iId = col('msgid', 'id');
  const out: RawMessage[] = [];
  for (const l of lines.slice(1)) {
    const c = splitCsv(l);
    const ts = anyTimeToMs(c[iTime]?.trim());
    const content = c[iContent] ?? '';
    if (!Number.isFinite(ts)) continue;
    out.push({
      msgId: iId >= 0 && c[iId] ? String(c[iId]) : null,
      ts,
      account: String(c[iAcc] ?? '').trim().toLowerCase(),
      name: String(c[iName] ?? '').trim(),
      contentType: iType >= 0 && c[iType] ? (TXT_TYPE[c[iType].trim()] ?? c[iType].trim()) : null,
      content,
    });
  }
  return out;
}

export interface ParseOptions {
  subject?: string;
  from?: string | null;
  to?: string | null;
  manifest?: ManifestRow[] | null;
  /** 账号 → 姓名（welink-cli 输入才需要）。 */
  names?: Record<string, string> | null;
  /** 已上传的文件名集合（用来标记 present）。 */
  presentFiles?: ReadonlySet<string> | null;
  sourceName?: string;
  /** 已经切好的消息（模型推断格式的兜底路径）；给了就不再自己解析 text。 */
  raw?: RawMessage[] | null;
}

/** 整条流水线的第一步：原文 → ParsedChat。抛错 = 解析不到任何消息。 */
/** 用能用的那个解析器：JSON（任何形状）→ 行头 TXT → CSV 记录；谁解析出的消息多用谁。 */
export function parseRawMessages(text: string): { raw: RawMessage[]; kind: 'welink-cli-json' | 'welink-txt' | 'welink-csv' } {
  const trimmed = text.replace(/^\uFEFF/, '').replace(/\u001b\[[0-9;]*m/g, '').trimStart();
  const tries: { raw: RawMessage[]; kind: 'welink-cli-json' | 'welink-txt' | 'welink-csv' }[] = [];
  if (/^[^\n]{0,200}?[[{]/.test(trimmed)) {
    try {
      tries.push({ raw: parseJsonInput(trimmed), kind: 'welink-cli-json' });
    } catch {
      /* 不是 JSON，继续 */
    }
  }
  tries.push({ raw: parseTxt(trimmed), kind: 'welink-txt' });
  tries.push({ raw: parseCsvRecords(trimmed), kind: 'welink-csv' });
  const good = (t: { raw: RawMessage[] }) => t.raw.filter((m) => Number.isFinite(m.ts)).length;
  tries.sort((a, b) => good(b) - good(a));
  return tries[0];
}

/** 解析失败时给人看的提示：说明认什么，附上文件开头几行。 */
export function describeUnparsed(text: string, label = ''): string {
  const headLines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 3).map((l) => l.slice(0, 120));
  return `没有解析到任何消息${label ? `（${label}）` : ''}。能认的：welink-cli 的 JSON（消息对象带时间 + 内容字段）、每条以「[日期 时间] 姓名（账号）」或「姓名（账号） 日期 时间」开头的 TXT（可带 #### 日期 #### 日头）、带「时间 / 发送人 / 内容」表头的 CSV。文件开头是：${headLines.map((l) => `「${l}」`).join(' ') || '（空）'}`;
}

/** 整条流水线的第一步：原文 → ParsedChat。抛错 = 解析不到任何消息。 */
export function parseChat(text: string, opts: ParseOptions = {}): ParsedChat {
  const { raw, kind } = opts.raw ? { raw: opts.raw, kind: 'welink-txt' as const } : parseRawMessages(text);
  const isJson = kind === 'welink-cli-json';
  if (!raw.filter((m) => Number.isFinite(m.ts)).length) throw new Error(describeUnparsed(text, opts.sourceName));
  const nameMap = new Map(Object.entries(opts.names ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  raw.sort((a, b) => a.ts - b.ts);
  let messages = raw.filter((m) => Number.isFinite(m.ts)).map((m, i) => normalize(m, i, nameMap));
  if (opts.from) messages = messages.filter((m) => m.date >= opts.from!);
  if (opts.to) messages = messages.filter((m) => m.date <= opts.to!);
  if (!messages.length) throw new Error('过滤后没有消息（检查起止日期）');
  messages.forEach((m, i) => (m.id = `m${i + 1}`));
  for (const m of messages) for (const a of m.attachments) a.msgId = m.id;

  // 引用回复 → 被回复消息（先姓名再内容前缀；账号可能是老工号）
  for (const m of messages) {
    if (!m.replyTo) continue;
    const want = m.replyTo.content.replace(/\s+/g, '').slice(0, 40);
    const candidates = messages.filter((x) => x.id !== m.id && x.ts <= m.ts && (x.account === m.replyTo!.account || x.name === m.replyTo!.name));
    for (let i = candidates.length - 1; i >= 0; i--) {
      const x = candidates[i];
      const body = (x.raw || '').replace(/\s+/g, '');
      if ((want && body.includes(want)) || (!want && x.hasAttachmentPlaceholder && m.replyTo.content.includes(PLACEHOLDER))) {
        m.replyTo.id = x.id;
        break;
      }
    }
  }

  // 附件清单 → 占位消息（同人、≤ 90 s，优先还没挂图的消息）
  const orphanAttachments: ParsedChat['orphanAttachments'] = [];
  if (opts.manifest?.length) {
    const placeholders = messages.filter((m) => m.hasAttachmentPlaceholder || m.type === 'image' || m.type === 'file');
    for (const r of opts.manifest) {
      let best: ParsedMessage | null = null;
      let bestScore = Infinity;
      for (const m of placeholders) {
        if (m.account !== r.account && m.name !== r.name) continue;
        const dt = Math.abs(m.ts - r.ts);
        if (!Number.isFinite(dt) || dt > 90_000) continue;
        const score = dt + m.attachments.length * 30_000;
        if (score < bestScore) {
          best = m;
          bestScore = score;
        }
      }
      const att: ParsedAttachment = { url: r.url || null, kind: r.kind, size: r.size, file: r.file, code: r.code || null, present: null, msgId: best?.id ?? null };
      if (best) {
        if (!best.attachments.some((a) => a.file === r.file)) best.attachments.push(att);
      } else {
        orphanAttachments.push({ ...att, account: r.account, name: r.name, time: r.time });
      }
    }
  }
  const present = opts.presentFiles ?? null;
  for (const m of messages) for (const a of m.attachments) a.present = present ? present.has(a.file) : null;
  for (const a of orphanAttachments) a.present = present ? present.has(a.file) : null;

  const rosterMap = new Map<string, RosterEntry>();
  for (const m of messages) {
    const r = rosterMap.get(m.account) ?? { account: m.account, name: m.name, count: 0, substantive: 0 };
    r.count++;
    if (m.type !== 'noise') r.substantive++;
    if (m.name && m.name !== m.account) r.name = m.name;
    rosterMap.set(m.account, r);
  }
  const roster = [...rosterMap.values()].sort((a, b) => b.count - a.count);
  const subject = opts.subject?.trim() || guessSubject(text.replace(/^\uFEFF/, '').trimStart()) || '聊天记录';
  return {
    schemaVersion: 1,
    subject,
    source: { kind: isJson ? 'welink-cli-json' : kind === 'welink-csv' ? 'welink-csv' : 'welink-txt', file: opts.sourceName ?? '', parsedAt: new Date().toISOString() },
    period: { start: messages[0].date, end: messages[messages.length - 1].date },
    roster,
    messages,
    orphanAttachments,
  };
}

function guessSubject(text: string): string {
  const first = text.split(/\r?\n/)[0] ?? '';
  const m = /^(.*?)聊天记录/.exec(first);
  return m ? m[1].replace(/^WeLink\s*群?\s*/, '').trim() : '';
}
