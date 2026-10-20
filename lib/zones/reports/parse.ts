// 版块报告 — 聊天记录解析（与 skill scripts/parse-chat.mjs 同规则，输入改为字符串）。
//
// 支持：A. WeLink 导出 TXT（"[YYYY-MM-DD HH:mm:ss] 姓名（账号）" + 正文行）
//      B. welink-cli 合并 JSON（数组）/ 单页 {respData:{chatInfo:[…]}}
// 附件清单 CSV（时间,发送人,姓名,类型,文件名,大小KB,外链,提取码,是否已下载）把 "[图片/附件]"
// 占位对到文件名；上传的 assets 再按文件名对到 ZoneReportAsset.key。
// 纯函数、无 IO：tests/zone-reports-parse.test.ts 直接跑。

import type { ParsedAttachment, ParsedChat, ParsedMessage, RosterEntry } from './schema';

const HEAD_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*(.+?)\s*[（(]([A-Za-z0-9_.-]+)[）)]\s*$/;
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
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
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

interface RawMessage {
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
  for (const line of lines) {
    const m = HEAD_RE.exec(line);
    if (m) {
      if (cur) finish(cur);
      const d = parseLocalTime(m[1]);
      cur = { msgId: null, ts: d ? d.getTime() : NaN, account: m[3].toLowerCase(), name: m[2].trim(), contentType: null, lines: [], content: '' };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) finish(cur);
  return out;
}

function fromWelinkCli(m: Record<string, unknown>): RawMessage {
  return {
    msgId: m.msgId != null ? String(m.msgId) : null,
    ts: Number(m.serverSendTime),
    account: String(m.sender ?? '').toLowerCase(),
    name: String(m.nameZH ?? m.senderName ?? ''),
    contentType: m.contentType ?? null,
    content: String(m.content ?? ''),
  };
}

function parseJsonInput(text: string): RawMessage[] {
  const o = JSON.parse(text) as unknown;
  const list = Array.isArray(o)
    ? o
    : ((o as { respData?: { chatInfo?: unknown[] } })?.respData?.chatInfo ?? (o as { chatInfo?: unknown[] })?.chatInfo ?? []);
  const seen = new Map<string, RawMessage>();
  for (const item of list as Record<string, unknown>[]) {
    const r = fromWelinkCli(item);
    seen.set(r.msgId ?? `${r.ts}:${seen.size}`, r);
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
  const t = text.replace(/^﻿/, '').trim();
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
}

/** 整条流水线的第一步：原文 → ParsedChat。抛错 = 解析不到任何消息。 */
export function parseChat(text: string, opts: ParseOptions = {}): ParsedChat {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  const isJson = trimmed.startsWith('[{') || trimmed.startsWith('{');
  const raw = isJson ? parseJsonInput(trimmed) : parseTxt(trimmed);
  if (!raw.length) throw new Error('没有解析到任何消息：TXT 每条消息应以 "[YYYY-MM-DD HH:mm:ss] 姓名（账号）" 开头，或提供 welink-cli 的 JSON');
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
  const subject = opts.subject?.trim() || guessSubject(trimmed) || '聊天记录';
  return {
    schemaVersion: 1,
    subject,
    source: { kind: isJson ? 'welink-cli-json' : 'welink-txt', file: opts.sourceName ?? '', parsedAt: new Date().toISOString() },
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
