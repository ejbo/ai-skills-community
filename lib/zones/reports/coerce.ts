// 版块报告 — 模型输出的「收，不拒」层（docs/contracts/reports.md §2d）。
//
// owner 2026-10-20：「怎么还是有这种问题，如果 json 一直会出问题，就不要用，我需要的是一致性和可靠性」。
// 以前每一步模型输出直接过 zod，id 写成数字、键名换个叫法、字符串超长、枚举写成英文、引用了不存在的消息——
// 任何一条都是 ✖，贴回去重试，两次不行整条流水线就挂。现在每一步先经这里：
//
//   1. coerceXxx：把形状上的小错修掉（能修的修、修不了的丢并记 warning），再过 zod；
//   2. autofixXxx：重试用尽但形状已经对了、只是引用校验不过（覆盖率 / 发言人对不上）→ 按规则补齐，不抛错；
//   3. fallbackXxx：模型连一个能用的对象都没给 → 完全用规则从原始消息生成一个"素"版本，报告照样出，
//      warnings 里写明哪一步是兜底的。
//
// 纯函数、无 IO、不依赖模型：tests/zone-reports-coerce.test.ts 直接跑。

import { CONFIDENCES, indexChat, MACRO_TAGS, RESOURCE_KINDS, SUBSTANTIVE_TYPES, VIEWPOINT_ROLES, type ChatIndex, type ClusterResult, type OverviewResult, type ParsedChat, type ParsedMessage, type RecapResult, type ThemeResult } from './schema';

type Obj = Record<string, unknown>;
export interface Coerced {
  value: unknown;
  warnings: string[];
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : v == null || v === '' ? [] : [v]);

/** 取第一个存在的键（模型常换叫法：messages / ids / msgRefs…）。 */
export function pickKey(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase().replace(/[_\s-]/g, ''), k]));
  for (const k of keys) {
    const hit = lower.get(k.toLowerCase().replace(/[_\s-]/g, ''));
    if (hit && o[hit] !== undefined && o[hit] !== null) return o[hit];
  }
  return undefined;
}

/** 字符串化 + trim + 截断（超长不是错，截掉）。 */
export function clip(v: unknown, max: number): string {
  let s = typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : Array.isArray(v) ? v.map((x) => clip(x, max)).join('；') : isObj(v) ? clip(pickKey(v, ['text', 'content', 'value', 'title', 'label']), max) : '';
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  return s;
}

/** 消息 id：12 / "12" / "#12" / "M12" / "msg12" / "m 12" / "m12-m15"（展开）/ "m1, m2"（拆开）→ ["m12", …] */
export function coerceMsgIds(v: unknown): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  const one = (x: unknown) => {
    if (typeof x === 'number' && Number.isInteger(x) && x > 0) return push(`m${x}`);
    if (isObj(x)) return one(pickKey(x, ['id', 'msgId', 'msg', 'ref']));
    if (typeof x !== 'string') return;
    for (const piece of x.split(/[,，;；、\s]+/)) {
      if (!piece) continue;
      const range = /^(?:m|msg|#)?\s*(\d+)\s*[-~–—]\s*(?:m|msg|#)?\s*(\d+)$/i.exec(piece);
      if (range) {
        const a = +range[1], b = +range[2];
        if (b >= a && b - a <= 200) for (let i = a; i <= b; i++) push(`m${i}`);
        continue;
      }
      const m = /^(?:m|msg|message|#)?\s*[_-]?\s*(\d+)$/i.exec(piece);
      if (m) push(`m${+m[1]}`);
    }
  };
  for (const x of asArray(v)) one(x);
  return out;
}

/** 主题 id：t1 / T1 / theme1 / theme_1 / 1 / "t01" → t1；认不出用位置。 */
export function coerceThemeId(v: unknown, index: number): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  const m = /^(?:t|theme|topic|主题)?\s*[_-]?\s*0*(\d{1,2})$/i.exec(s);
  return m ? `t${+m[1]}` : `t${index + 1}`;
}

export function coerceEnum<const T extends readonly string[]>(v: unknown, allowed: T, aliases: Record<string, T[number]> = {}): T[number] | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if ((allowed as readonly string[]).includes(s)) return s as T[number];
  const key = s.toLowerCase().replace(/[\s_-]/g, '');
  for (const a of allowed) if (a.toLowerCase() === key) return a;
  if (aliases[key]) return aliases[key];
  for (const [k, val] of Object.entries(aliases)) if (key.includes(k) || k.includes(key)) return val;
  for (const a of allowed) if (key.includes(a.toLowerCase())) return a;
  return undefined;
}

const MACRO_ALIASES: Record<string, (typeof MACRO_TAGS)[number]> = {
  consensus: '共识', agreement: '共识', agree: '共识', 一致: '共识',
  disagreement: '分歧', divergence: '分歧', debate: '分歧', dispute: '分歧', 争议: '分歧', 争论: '分歧',
  judgment: '判断', judgement: '判断', verdict: '判断', opinion: '判断', 观点: '判断', 结论: '判断',
  landscape: '格局', industry: '格局', market: '格局', 产业: '格局', 业界: '格局', 动态: '格局',
  leverage: '杠杆', lever: '杠杆', key: '杠杆', 抓手: '杠杆', 关键: '杠杆',
  risk: '风险', risks: '风险', concern: '风险', 隐患: '风险',
  progress: '进展', update: '进展', milestone: '进展', 动作: '进展', 落地: '进展',
};
const ROLE_ALIASES: Record<string, (typeof VIEWPOINT_ROLES)[number]> = {
  propose: '提出', proposal: '提出', raise: '提出', question: '提出', 发起: '提出', 提问: '提出',
  respond: '回应', response: '回应', reply: '回应', answer: '回应', 回复: '回应', 回答: '回应',
  challenge: '质疑', doubt: '质疑', critique: '质疑', 反驳: '质疑',
  supplement: '补充', add: '补充', addition: '补充', 补充说明: '补充',
  judgment: '判断', judgement: '判断', 观点: '判断',
  progress: '进展', update: '进展',
  conclusion: '结论', summary: '结论', 总结: '结论',
  notice: '通知', announcement: '通知', notify: '通知', 公告: '通知',
};
const CONF_ALIASES: Record<string, (typeof CONFIDENCES)[number]> = { 高: 'high', h: 'high', strong: 'high', 中: 'medium', m: 'medium', mid: 'medium', moderate: 'medium', 低: 'low', l: 'low', weak: 'low' };
const KIND_ALIASES: Record<string, (typeof RESOURCE_KINDS)[number]> = { 论文: 'paper', arxiv: 'paper', 仓库: 'repo', github: 'repo', code: 'repo', 文章: 'article', blog: 'article', 博客: 'article', news: 'article', 内部: 'internal', 视频: 'video', 文档: 'doc', 其他: 'other' };

/** 日期 → YYYY-MM-DD；2026/9/20、2026.09.20、"2026-09-20 07:08" 都认；认不出 null。 */
export function coerceDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (!m) return null;
  const mm = m[2].padStart(2, '0'), dd = m[3].padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return `${m[1]}-${mm}-${dd}`;
}

function httpUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : isObj(v) ? clip(pickKey(v, ['url', 'href', 'link']), 2000) : '';
  return /^https?:\/\//i.test(s) ? s : null;
}

// ── ① 聚类 ─────────────────────────────────────────────────────────────────────

const THEME_KEYS = ['themes', 'topics', 'clusters', 'groups', 'categories', 'subjects', '主题'];

export function coerceCluster(raw: unknown, chat: ParsedChat): Coerced {
  const warnings: string[] = [];
  const known = new Set(chat.messages.map((m) => m.id));
  let o: Obj = isObj(raw) ? raw : {};
  if (Array.isArray(raw)) o = { themes: raw };
  let themesRaw = asArray(pickKey(o, THEME_KEYS));
  // 没有 themes 键但顶层本身像一个主题列表的 map：{ "t1": {...}, "t2": {...} }
  if (!themesRaw.length && Object.values(o).some((v) => isObj(v) && pickKey(v, ['msgIds', 'messages', 'ids']) !== undefined)) themesRaw = Object.values(o).filter(isObj);
  const dropped: string[] = [];
  const ids = (v: unknown, where: string) => {
    const all = coerceMsgIds(v);
    const ok = all.filter((id) => known.has(id));
    if (ok.length < all.length) dropped.push(`${where} 引用了 ${all.length - ok.length} 条不存在的消息`);
    return ok;
  };
  const seenIds = new Set<string>();
  let themes = themesRaw
    .map((t, i) => {
      if (!isObj(t)) return null;
      const msgIds = ids(pickKey(t, ['msgIds', 'messageIds', 'messages', 'ids', 'msgs', 'refs', 'msgRefs', 'items', '消息']), `themes[${i}]`).filter((id) => {
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      const title = clip(pickKey(t, ['title', 'name', 'topic', 'theme', 'subject', 'label', '标题', '主题']), 60) || `主题 ${i + 1}`;
      return { id: coerceThemeId(pickKey(t, ['id', 'themeId', 'key']), i), title, tagline: clip(pickKey(t, ['tagline', 'summary', 'subtitle', 'desc', 'description', 'oneLiner', '一句话', '定位']), 200), msgIds };
    })
    .filter((t): t is NonNullable<typeof t> => !!t && t.msgIds.length > 0);
  // id 去重（按位置重排）
  const used = new Set<string>();
  themes = themes.map((t, i) => {
    let id = t.id;
    if (used.has(id)) id = `t${i + 1}`;
    while (used.has(id)) id = `t${+id.slice(1) + 1}`;
    used.add(id);
    return { ...t, id };
  });
  const recap = ids(pickKey(o, ['recap', 'misc', 'others', 'other', 'trivia', '花絮', '其他']), 'recap');
  const events = ids(pickKey(o, ['events', 'activities', 'notices', 'announcements', '活动', '通知']), 'events');
  const skip = ids(pickKey(o, ['skip', 'noise', 'ignore', 'drop', 'ignored', '跳过', '无信息量']), 'skip');
  if (themes.length > 12) {
    warnings.push(`模型给了 ${themes.length} 个主题，只保留消息最多的 12 个，其余并入 recap`);
    const sorted = [...themes].sort((a, b) => b.msgIds.length - a.msgIds.length);
    const keep = new Set(sorted.slice(0, 12).map((t) => t.id));
    for (const t of themes) if (!keep.has(t.id)) recap.push(...t.msgIds);
    themes = themes.filter((t) => keep.has(t.id)).map((t, i) => ({ ...t, id: `t${i + 1}` }));
  }
  if (dropped.length) warnings.push(`聚类：${dropped.slice(0, 5).join('；')}（已丢弃）`);
  return { value: { themes, events, recap, skip }, warnings };
}

/** 形状对了但引用校验不过（典型：覆盖率 < 85%）→ 没归类的有信息量消息凑成「其他讨论」，或并入 recap。 */
export function autofixCluster(c: ClusterResult, chat: ParsedChat): ClusterResult {
  const seen = new Set<string>([...c.themes.flatMap((t) => t.msgIds), ...c.events, ...c.recap, ...c.skip]);
  const missing = chat.messages.filter((m) => SUBSTANTIVE_TYPES.has(m.type) && !seen.has(m.id)).map((m) => m.id);
  if (!missing.length) return c;
  if (missing.length >= 3 && c.themes.length < 12) {
    const id = `t${Math.max(0, ...c.themes.map((t) => +t.id.slice(1))) + 1}`;
    return { ...c, themes: [...c.themes, { id, title: '其他讨论', tagline: '模型没有归类的其余有信息量消息', msgIds: missing }] };
  }
  return { ...c, recap: [...c.recap, ...missing] };
}

/** 模型一个能用的聚类都没给：按日期分段（≤ 8 段），非信息量消息进 skip。 */
export function fallbackCluster(chat: ParsedChat): ClusterResult {
  const subst = chat.messages.filter((m) => SUBSTANTIVE_TYPES.has(m.type));
  const byDay = new Map<string, string[]>();
  for (const m of subst) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m.id]);
  let groups = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ids]) => ({ start: date, end: date, ids }));
  while (groups.length > 8) {
    // 合并相邻两段里消息总数最小的一对
    let at = 0, best = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      const n = groups[i].ids.length + groups[i + 1].ids.length;
      if (n < best) (best = n), (at = i);
    }
    groups.splice(at, 2, { start: groups[at].start, end: groups[at + 1].end, ids: [...groups[at].ids, ...groups[at + 1].ids] });
  }
  const md = (d: string) => d.slice(5);
  const themes = groups
    .filter((g) => g.ids.length)
    .map((g, i) => ({ id: `t${i + 1}`, title: g.start === g.end ? `${md(g.start)} 的讨论` : `${md(g.start)} ~ ${md(g.end)} 的讨论`, tagline: `这段时间里的 ${g.ids.length} 条有信息量消息（模型聚类失败，按时间分段）`, msgIds: g.ids }));
  const skip = chat.messages.filter((m) => !SUBSTANTIVE_TYPES.has(m.type)).map((m) => m.id);
  if (!themes.length) themes.push({ id: 't1', title: '本期讨论', tagline: '记录里没有可归类的文本消息', msgIds: chat.messages.slice(0, 1).map((m) => m.id) });
  return { themes, events: [], recap: [], skip };
}

// ── ② 主题 ─────────────────────────────────────────────────────────────────────

interface ClusterTheme {
  id: string;
  title: string;
  tagline: string;
  msgIds: string[];
}

/** 一条 msgRefs 列表里谁发得最多 → 用来修发言人写错 / 账号不在名单的情况。 */
function majorityAuthor(refs: string[], index: ChatIndex): ParsedMessage | null {
  const count = new Map<string, { n: number; m: ParsedMessage }>();
  for (const id of refs) {
    const m = index.byId.get(id);
    if (!m) continue;
    const cur = count.get(m.account);
    count.set(m.account, { n: (cur?.n ?? 0) + 1, m: cur?.m ?? m });
  }
  let best: { n: number; m: ParsedMessage } | null = null;
  for (const v of count.values()) if (!best || v.n > best.n) best = v;
  return best?.m ?? null;
}

export function coerceTheme(raw: unknown, chat: ParsedChat, theme: ClusterTheme, index: ChatIndex = indexChat(chat)): Coerced {
  const warnings: string[] = [];
  const o: Obj = isObj(raw) ? raw : {};
  const macroRaw = asArray(pickKey(o, ['macro', 'summary', 'overview', 'takeaways', '宏观', '总结']));
  let macro = macroRaw
    .map((m) => {
      if (typeof m === 'string') return { tag: '判断' as const, text: clip(m, 400) };
      if (!isObj(m)) return null;
      const text = clip(pickKey(m, ['text', 'content', 'desc', 'summary', 'value']), 400);
      const tag = coerceEnum(pickKey(m, ['tag', 'type', 'kind', 'label', 'category']), MACRO_TAGS, MACRO_ALIASES) ?? '判断';
      return text ? { tag, text } : null;
    })
    .filter((m): m is { tag: (typeof MACRO_TAGS)[number]; text: string } => !!m)
    .slice(0, 6);
  const tagline = clip(pickKey(o, ['tagline', 'subtitle', 'summary', 'desc', 'description', 'oneLiner', '一句话', '定位']), 200) || theme.tagline || `围绕「${theme.title}」的讨论`;
  if (!macro.length) {
    macro = [{ tag: '判断', text: tagline }];
    warnings.push(`${theme.id}: 模型没给 macro，用 tagline 顶上`);
  }
  const allowed = new Set(theme.msgIds);
  let fixedSpeakers = 0, droppedVp = 0, droppedUrls = 0;
  const viewpoints = asArray(pickKey(o, ['viewpoints', 'timeline', 'points', 'opinions', 'views', '观点', '时间线']))
    .map((v) => {
      if (!isObj(v)) return null;
      let refs = coerceMsgIds(pickKey(v, ['msgRefs', 'refs', 'msgIds', 'messages', 'ids', 'sources_ids', '引用']));
      refs = refs.filter((id) => index.byId.has(id));
      if (!refs.length) return null;
      let text = clip(pickKey(v, ['text', 'content', 'summary', 'point', 'view', '观点', '内容']), 400);
      const quote = clip(pickKey(v, ['quote', 'original', '原话', '引用原文']), 200);
      if (!text) text = quote || clip(index.byId.get(refs[0])?.text, 400);
      if (!text) return null;
      let account = clip(pickKey(v, ['account', 'id', 'userId', 'w3', 'w3account', '账号', '工号']), 40).toLowerCase();
      let speaker = clip(pickKey(v, ['speaker', 'name', 'who', 'author', 'person', '发言人', '姓名']), 60);
      // 账号不在名单 / 没填 / 引用的消息没有一条是他发的 → 以引用消息的作者为准（内容本来就是从这些消息里来的）
      const ownsRef = refs.some((id) => index.byId.get(id)?.account === account);
      if (!account || !index.accounts.has(account) || !ownsRef) {
        const byName = speaker ? chat.roster.find((r) => r.name === speaker) : null;
        const author = byName && refs.some((id) => index.byId.get(id)?.account === byName.account) ? byName : null;
        const m = author ? null : majorityAuthor(refs, index);
        if (author) account = author.account;
        else if (m) (account = m.account), (speaker = m.name);
        fixedSpeakers++;
      }
      if (!speaker) speaker = index.accounts.get(account) || account;
      const date = coerceDate(pickKey(v, ['date', 'day', 'time', '日期'])) ?? index.byId.get(refs[0])?.date ?? chat.period.start;
      const role = coerceEnum(pickKey(v, ['role', 'kind', 'type', '角色']), VIEWPOINT_ROLES, ROLE_ALIASES);
      const sources = asArray(pickKey(v, ['sources', 'links', 'refsUrls', 'urls', '来源']))
        .map((s) => {
          const url = httpUrl(s);
          const label = clip(isObj(s) ? pickKey(s, ['label', 'title', 'name', 'text']) : s, 120) || (url ? url.replace(/^https?:\/\//, '').slice(0, 120) : '');
          if (!label) return null;
          if (url && !index.urls.has(url)) {
            droppedUrls++;
            return { label, url: null };
          }
          return { label, url };
        })
        .filter((s): s is { label: string; url: string | null } => !!s)
        .slice(0, 10);
      if (!refs.some((id) => allowed.has(id))) warnings.push(`${theme.id}: 一条观点引用的消息都不属于本主题（${refs.slice(0, 3).join(' ')}）`);
      return { speaker, account, date, ...(role ? { role } : {}), text, ...(quote ? { quote } : {}), sources, msgRefs: refs };
    })
    .filter((v): v is NonNullable<typeof v> => {
      if (!v) droppedVp++;
      return !!v;
    })
    .slice(0, 20);
  const conclusionRaw = clip(pickKey(o, ['conclusion', 'verdict', 'takeaway', '结论', '小结']), 400);
  const openQuestions = asArray(pickKey(o, ['openQuestions', 'questions', 'open', 'todo', '待解', '未决问题']))
    .map((q) => clip(q, 200))
    .filter(Boolean)
    .slice(0, 6);
  const resources = asArray(pickKey(o, ['resources', 'links', 'references', 'refs', '资料', '链接']))
    .map((r) => {
      const url = httpUrl(r);
      if (!url || !index.urls.has(url)) {
        if (url) droppedUrls++;
        return null;
      }
      const label = clip(isObj(r) ? pickKey(r, ['label', 'title', 'name', 'text']) : null, 120) || url.replace(/^https?:\/\//, '').slice(0, 120);
      const kind = isObj(r) ? coerceEnum(pickKey(r, ['kind', 'type', 'category']), RESOURCE_KINDS, KIND_ALIASES) : undefined;
      return { label, url, ...(kind ? { kind } : {}) };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, 20);
  if (fixedSpeakers) warnings.push(`${theme.id}: ${fixedSpeakers} 条观点的发言人按引用消息的作者修正`);
  if (droppedVp) warnings.push(`${theme.id}: 丢弃 ${droppedVp} 条没有有效引用 / 没有正文的观点`);
  if (droppedUrls) warnings.push(`${theme.id}: 去掉 ${droppedUrls} 个记录里没有的链接`);
  return { value: { id: theme.id, title: clip(pickKey(o, ['title', 'name', '标题']), 60) || theme.title, tagline, macro, viewpoints, conclusion: conclusionRaw || null, openQuestions, resources }, warnings };
}

/** 规则生成一个"素"主题：原文节选当观点（同人连续消息合并），链接当资料。 */
export function fallbackTheme(theme: ClusterTheme, chat: ParsedChat, index: ChatIndex = indexChat(chat)): ThemeResult {
  const msgs = theme.msgIds.map((id) => index.byId.get(id)).filter((m): m is ParsedMessage => !!m && SUBSTANTIVE_TYPES.has(m.type) && !!m.text.trim());
  const groups: ParsedMessage[][] = [];
  for (const m of msgs) {
    const last = groups[groups.length - 1];
    if (last && last[0].account === m.account && m.ts - last[last.length - 1].ts < 15 * 60_000) last.push(m);
    else groups.push([m]);
  }
  const viewpoints = groups.slice(0, 12).map((g) => ({
    speaker: g[0].name,
    account: g[0].account,
    date: g[0].date,
    text: clip(g.map((m) => m.text).join(' '), 400),
    sources: [] as { label: string; url?: string | null }[],
    msgRefs: g.map((m) => m.id),
  }));
  const urls = new Map<string, string>();
  for (const m of msgs) for (const l of m.links) if (!urls.has(l.url)) urls.set(l.url, l.title || l.host);
  const speakers = new Set(msgs.map((m) => m.account)).size;
  return {
    id: theme.id,
    title: theme.title,
    tagline: theme.tagline || `围绕「${theme.title}」的 ${theme.msgIds.length} 条消息`,
    macro: [{ tag: '进展', text: `本主题 ${theme.msgIds.length} 条消息、${speakers} 位发言人（模型摘要失败，以下为原文节选，未经提炼）` }],
    viewpoints: viewpoints.length ? viewpoints : [{ speaker: chat.roster[0]?.name ?? '群', account: chat.roster[0]?.account ?? 'unknown', date: chat.period.start, text: '（这个主题里没有可引用的文本消息）', sources: [], msgRefs: theme.msgIds.slice(0, 1) }],
    conclusion: null,
    openQuestions: [],
    resources: [...urls.entries()].slice(0, 20).map(([url, label]) => ({ label: clip(label, 120) || url.slice(0, 120), url })),
  };
}

// ── ③ 活动与花絮 ───────────────────────────────────────────────────────────────

export function coerceRecap(raw: unknown, chat: ParsedChat, index: ChatIndex = indexChat(chat)): Coerced {
  const warnings: string[] = [];
  let o: Obj = isObj(raw) ? raw : {};
  if (Array.isArray(raw)) o = { recap: { items: raw } };
  const refsOf = (v: unknown) => coerceMsgIds(v).filter((id) => index.byId.has(id));
  const sourcesOf = (v: unknown) =>
    asArray(v)
      .map((s) => {
        const url = httpUrl(s);
        const label = clip(isObj(s) ? pickKey(s, ['label', 'title', 'name', 'text']) : s, 120) || (url ? url.replace(/^https?:\/\//, '').slice(0, 120) : '');
        return label ? { label, url: url && index.urls.has(url) ? url : null } : null;
      })
      .filter((s): s is { label: string; url: string | null } => !!s)
      .slice(0, 10);
  let recapRaw = pickKey(o, ['recap', 'misc', 'trivia', '花絮']);
  if (Array.isArray(recapRaw)) recapRaw = { items: recapRaw };
  let recap: { title: string; items: { text: string; msgRefs: string[]; sources: { label: string; url: string | null }[] }[] } | null = null;
  if (isObj(recapRaw)) {
    const items = asArray(pickKey(recapRaw, ['items', 'list', 'entries', 'points']))
      .map((it) => {
        const text = clip(isObj(it) ? pickKey(it, ['text', 'content', 'summary', 'title']) : it, 300);
        const msgRefs = isObj(it) ? refsOf(pickKey(it, ['msgRefs', 'refs', 'msgIds', 'ids', 'messages'])) : [];
        if (!text || !msgRefs.length) return null;
        return { text, msgRefs, sources: isObj(it) ? sourcesOf(pickKey(it, ['sources', 'links', 'urls'])) : [] };
      })
      .filter((it): it is NonNullable<typeof it> => !!it)
      .slice(0, 30);
    recap = { title: clip(pickKey(recapRaw, ['title', 'name']), 60) || '非科研 · 快速 Recap', items };
  }
  const events = asArray(pickKey(o, ['events', 'activities', 'notices', '活动', '通知']))
    .map((ev) => {
      if (!isObj(ev)) return null;
      const msgRefs = refsOf(pickKey(ev, ['msgRefs', 'refs', 'msgIds', 'ids', 'messages']));
      const title = clip(pickKey(ev, ['title', 'name', 'text', '标题']), 160);
      if (!title || !msgRefs.length) return null;
      const url = httpUrl(pickKey(ev, ['url', 'link', 'href']));
      return {
        title,
        date: coerceDate(pickKey(ev, ['date', 'time', 'when', '日期'])) ?? null,
        host: clip(pickKey(ev, ['host', 'organizer', 'speaker', 'by', '主办', '主讲']), 80) || null,
        url: url && index.urls.has(url) ? url : null,
        note: clip(pickKey(ev, ['note', 'desc', 'description', 'summary', '备注']), 300) || null,
        msgRefs,
      };
    })
    .filter((ev): ev is NonNullable<typeof ev> => !!ev)
    .slice(0, 40);
  if (recap && !recap.items.length && !events.length) warnings.push('活动与花絮：模型输出里没有一条带有效引用的条目');
  return { value: { recap: recap && recap.items.length ? recap : null, events }, warnings };
}

export function fallbackRecap(eventIds: string[], recapIds: string[], chat: ParsedChat, index: ChatIndex = indexChat(chat)): RecapResult {
  const msg = (id: string) => index.byId.get(id);
  const items = recapIds
    .map(msg)
    .filter((m): m is ParsedMessage => !!m && !!(m.text || m.cardTitle))
    .slice(0, 30)
    .map((m) => ({ text: clip(`${m.name}：${m.text || m.cardTitle}`, 300), msgRefs: [m.id], sources: [] as { label: string; url?: string | null }[] }));
  const events = eventIds
    .map(msg)
    .filter((m): m is ParsedMessage => !!m && !!(m.text || m.cardTitle))
    .slice(0, 40)
    .map((m) => ({ title: clip((m.text || m.cardTitle || '').split(/\n/)[0], 160), date: m.date, host: null, url: m.links[0]?.url ?? null, note: null, msgRefs: [m.id] }));
  return { recap: items.length ? { title: '非科研 · 快速 Recap', items } : null, events };
}

// ── ④ 要点 ─────────────────────────────────────────────────────────────────────

interface ThemeLite {
  id: string;
  title: string;
  tagline: string;
  conclusion?: string | null;
  macro?: { tag: string; text: string }[];
}

export function coerceOverview(raw: unknown, themes: ThemeLite[]): Coerced {
  const warnings: string[] = [];
  const o: Obj = isObj(raw) ? raw : {};
  const ids = new Set(themes.map((t) => t.id));
  const themeId = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    const id = coerceThemeId(v, -1);
    if (ids.has(id)) return id;
    const byTitle = typeof v === 'string' ? themes.find((t) => t.title === v.trim() || t.title.includes(v.trim())) : null;
    return byTitle?.id ?? null;
  };
  const pointers = (v: unknown, max: number, textMax = 300) =>
    asArray(v)
      .map((p) => {
        if (typeof p === 'string') return { text: clip(p, textMax), themeId: null as string | null, src: null as Obj | null };
        if (!isObj(p)) return null;
        const text = clip(pickKey(p, ['text', 'content', 'point', 'summary', 'title', '要点']), textMax);
        return text ? { text, themeId: themeId(pickKey(p, ['themeId', 'theme', 'topic', 'ref', '主题'])), src: p } : null;
      })
      .filter((p): p is NonNullable<typeof p> => !!p)
      .slice(0, max);
  const highlights = pointers(pickKey(o, ['highlights', 'keyPoints', 'points', 'summary', 'bullets', '要点', '亮点']), 8).map(({ text, themeId }) => ({ text, themeId }));
  // 站内 zod 要 ≥ 2，skill 的 validate.mjs 要 ≥ 3：不够就用主题定位 / 宏观总结补到 3
  if (highlights.length < 3) {
    const pool: { text: string; themeId: string | null }[] = [
      ...themes.map((t) => ({ text: clip(`${t.title}：${t.tagline}`, 300), themeId: t.id })),
      ...themes.flatMap((t) => (t.macro ?? []).map((m) => ({ text: clip(m.text, 300), themeId: t.id }))),
    ];
    for (const p of pool) {
      if (highlights.length >= 3) break;
      if (p.text && !highlights.some((h) => h.text === p.text)) highlights.push(p);
    }
    if (highlights.length < 2) highlights.push({ text: '本期讨论', themeId: themes[0]?.id ?? null });
    warnings.push('要点：highlights 不足 3 条，用主题定位补齐');
  }
  let judgments = pointers(pickKey(o, ['judgments', 'judgements', 'conclusions', 'verdicts', 'assessments', '判断', '结论']), 6).map(({ text, themeId, src }) => ({
    text,
    themeId,
    confidence: (src ? coerceEnum(pickKey(src, ['confidence', 'level', 'certainty', '置信度']), CONFIDENCES, CONF_ALIASES) : undefined) ?? 'medium',
  }));
  if (!judgments.length) {
    const t = themes.find((x) => x.conclusion) ?? themes[0];
    judgments = [{ text: clip(t?.conclusion || t?.tagline || highlights[0]?.text || '本期无明确判断', 300), themeId: t?.id ?? null, confidence: 'low' }];
    warnings.push('要点：模型没给 judgments，用主题结论顶上');
  }
  const actions = pointers(pickKey(o, ['actions', 'todos', 'nextSteps', 'followUps', 'actionItems', '行动', '待办']), 10).map(({ text, themeId, src }) => ({
    text,
    themeId,
    owner: src ? clip(pickKey(src, ['owner', 'who', 'assignee', '负责人']), 80) || null : null,
    ownerAccount: src ? clip(pickKey(src, ['ownerAccount', 'account', '账号']), 40).toLowerCase() || null : null,
    due: src ? coerceDate(pickKey(src, ['due', 'deadline', 'by', '截止'])) : null,
  }));
  const headline = clip(pickKey(o, ['headline', 'title', 'oneLiner', 'summary', 'lead', '一句话', '标题']), 160) || clip(`本期 ${themes.length} 个主题：${themes.map((t) => t.title).join('、')}`, 160);
  return { value: { headline, highlights, judgments, actions }, warnings };
}

export function fallbackOverview(themes: ThemeLite[]): OverviewResult {
  return coerceOverview({}, themes).value as OverviewResult;
}

// ── 导入模式：skill 产出的 report.json ─────────────────────────────────────────

/** 导入的 report.json 只修最外层：schemaVersion / kind / period / summary / 主题 id，其余原样。 */
export function coerceImportedReport(raw: unknown): Coerced {
  const warnings: string[] = [];
  const o: Obj = isObj(raw) ? { ...raw } : {};
  o.schemaVersion = 1;
  const kind = coerceEnum(o.kind, ['daily', 'weekly', 'monthly', 'custom'] as const, { 日报: 'daily', 周报: 'weekly', 月报: 'monthly', day: 'daily', week: 'weekly', month: 'monthly' });
  if (!kind) warnings.push(`report.json：kind "${String(o.kind)}" 不认识，按 custom`);
  o.kind = kind ?? 'custom';
  const themes = asArray(pickKey(o, THEME_KEYS)).filter(isObj).map((t, i) => ({ ...t, id: coerceThemeId(t.id, i), title: clip(t.title, 200) || `主题 ${i + 1}`, tagline: clip(t.tagline, 400), msgIds: coerceMsgIds(t.msgIds), viewpoints: asArray(t.viewpoints), macro: asArray(t.macro), openQuestions: asArray(t.openQuestions), resources: asArray(t.resources), conclusion: typeof t.conclusion === 'string' ? t.conclusion : null }));
  o.themes = themes.slice(0, 12);
  const p = isObj(o.period) ? o.period : {};
  const dates = themes.flatMap((t) => asArray(t.viewpoints).map((v) => (isObj(v) ? coerceDate(v.date) : null))).filter((d): d is string => !!d).sort();
  o.period = { start: coerceDate(p.start) ?? dates[0] ?? '1970-01-01', end: coerceDate(p.end) ?? dates[dates.length - 1] ?? coerceDate(p.start) ?? '1970-01-01', label: clip(p.label, 80) };
  o.title = clip(o.title, 200) || `${clip(o.subject, 60) || '聊天记录'} 报告`;
  const summary = coerceOverview(o.summary, themes.map((t) => ({ id: t.id, title: t.title, tagline: t.tagline, conclusion: t.conclusion, macro: t.macro.filter(isObj).map((m) => ({ tag: String(m.tag ?? ''), text: String(m.text ?? '') })) })));
  o.summary = summary.value;
  warnings.push(...summary.warnings);
  if (!isObj(o.stats)) o.stats = {};
  if (!Array.isArray(o.events)) o.events = [];
  if (!Array.isArray(o.attachments)) o.attachments = [];
  if (!Array.isArray(o.unassigned)) o.unassigned = [];
  return { value: o, warnings };
}
