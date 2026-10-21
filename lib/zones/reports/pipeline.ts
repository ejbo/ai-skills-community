// 版块报告 — 生成流水线（docs/contracts/reports.md §2）。
//
// queued → parsing → clustering → summarizing → assembling → ingesting → ready / failed
// 和知识库 triggerIndexing 同款：fire-and-forget，状态落在行上，页面轮询。
// 中间产物（messagesJson / clusterJson / reportJson）都在行上，retry 从失败的那一步继续。
// heartbeatAt 每步更新；running 超过 STALE_LOCK_MS 无心跳视为死亡，可重新认领。

import fsp from 'node:fs/promises';
import type { Prisma, ZoneReportStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getReportProvider } from './provider';
import { zoneMediaAbsPath } from '@/lib/zones/storage';
import { assembleReport } from './assemble';
import { matchRosterToUsers } from './authors';
import { buildDigest, buildListBundle, buildOutline, buildThemeBundle, computeStats } from './digest';
import { callJson, parseModelJson, ReportLlmError } from './llm';
import { autofixCluster, coerceCluster, coerceImportedReport, coerceOverview, coerceRecap, coerceTheme, fallbackCluster, fallbackOverview, fallbackRecap, fallbackTheme } from './coerce';
import { inferLineFormat, splitWithSpec } from './infer-format';
import { describeUnparsed, parseChat, parseManifest, parseRawMessages } from './parse';
import { unpackReportBundle } from './unpack';
import { notifyReportReady } from '@/lib/notifications';
import { clusterPrompt, mergeClustersPrompt, overviewPrompt, recapPrompt, themePrompt, type ReportInstructions } from './prompts';
import {
  clusterSchema,
  indexChat,
  overviewSchema,
  recapSchema,
  reportSchema,
  themeSchema,
  validateCluster,
  validateOverview,
  validateRecap,
  validateTheme,
  type ClusterResult,
  type OverviewResult,
  type ParsedChat,
  type RecapResult,
  type Report,
  type ReportKind,
  type ThemeResult,
} from './schema';

export const STALE_LOCK_MS = 10 * 60 * 1000;
const THEME_CONCURRENCY = 2;
const RUNNING: ReadonlySet<ZoneReportStatus> = new Set(['parsing', 'clustering', 'summarizing', 'assembling', 'ingesting']);

export function isRunningStatus(s: ZoneReportStatus): boolean {
  return RUNNING.has(s);
}

/** running 但心跳过期 ⇒ 视为死亡（页面显示为 failed，可重试）。 */
export function effectiveStatus(row: { status: ZoneReportStatus; heartbeatAt: Date | null }, now = Date.now()): ZoneReportStatus {
  if (!isRunningStatus(row.status)) return row.status;
  if (row.heartbeatAt && now - row.heartbeatAt.getTime() > STALE_LOCK_MS) return 'failed';
  return row.status;
}

interface ClusterJson {
  cluster: ClusterResult;
  themes: Record<string, ThemeResult>;
  recap: RecapResult | null;
  overview: OverviewResult | null;
  warnings: string[];
}

function emptyClusterJson(): ClusterJson {
  return { cluster: { themes: [], events: [], recap: [], skip: [] }, themes: {}, recap: null, overview: null, warnings: [] };
}

async function setStage(id: string, status: ZoneReportStatus, stage: string, progress: number, extra: Prisma.ZoneReportUpdateInput = {}): Promise<void> {
  await prisma.zoneReport.update({ where: { id }, data: { status, stage, progress, heartbeatAt: new Date(), ...extra } });
}

/** 读上传的文本文件：按 BOM 识别 UTF-16（WeLink 在 Windows 上偶尔这么导）；其余按 UTF-8。 */
async function readKey(key: string | null): Promise<string | null> {
  if (!key) return null;
  const abs = zoneMediaAbsPath(key);
  if (!abs) return null;
  const buf = await fsp.readFile(abs);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** Fire-and-forget. 认领失败（别人在跑）返回 false。 */
export function triggerZoneReport(id: string): void {
  void runZoneReport(id).catch((e) => console.error('[zone-report] run failed', id, e));
}

export async function runZoneReport(id: string): Promise<boolean> {
  const now = new Date();
  // 认领：queued / failed，或 running 但心跳过期
  const claimed = await prisma.zoneReport.updateMany({
    where: {
      id,
      OR: [{ status: { in: ['queued', 'failed'] } }, { status: { in: [...RUNNING] }, heartbeatAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }],
    },
    data: { heartbeatAt: now, error: null },
  });
  if (claimed.count === 0) return false;

  const select = {
    id: true,
    zoneId: true,
    createdById: true,
    kind: true,
    title: true,
    subject: true,
    periodStart: true,
    periodEnd: true,
    status: true,
    sourceKey: true,
    sourceName: true,
    manifestKey: true,
    importKey: true,
    bundleKey: true,
    namesJson: true,
    instructions: true,
    instructionMode: true,
    messagesJson: true,
    clusterJson: true,
    reportJson: true,
    assets: { select: { key: true, name: true } },
  } satisfies Prisma.ZoneReportSelect;
  let row = await prisma.zoneReport.findUnique({ where: { id }, select });
  if (!row) return false;
  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    if (log.length > 200) log.shift();
  };
  const from = row.periodStart ? row.periodStart.toISOString().slice(0, 10) : undefined;
  const to = row.periodEnd ? row.periodEnd.toISOString().slice(0, 10) : undefined;
  let assetKeys = new Map(row.assets.map((a) => [a.name, a.key]));
  const ins: ReportInstructions | null = row.instructions.trim() ? { text: row.instructions, mode: row.instructionMode === 'override' ? 'override' : 'append' } : null;
  let modelName: string | null = null;
  try {
    modelName = (await getReportProvider()).model;
  } catch {
    modelName = null;
  }

  try {
    // ── 0. 整包上传：先解包成 sourceKey / manifestKey / importKey / assets（可重入）────
    if (row.bundleKey && !row.sourceKey && !row.importKey) {
      await setStage(id, 'parsing', '解包上传的文件夹 / zip', 2);
      const un = await unpackReportBundle(id, row.bundleKey, note);
      if (un.skipped.length) note(`跳过：${un.skipped.slice(0, 20).join('；')}`);
      const fresh = await prisma.zoneReport.findUnique({ where: { id }, select });
      if (!fresh) return false;
      row = fresh;
      assetKeys = new Map(row.assets.map((a) => [a.name, a.key]));
    }

    // ── 导入模式：skill 产出的 report.json ──────────────────────────────────
    if (row.importKey) {
      await setStage(id, 'assembling', '导入 report.json', 10);
      const text = await readKey(row.importKey);
      if (!text) throw new Error('读不到上传的 report.json');
      let importedRaw: unknown;
      try {
        importedRaw = JSON.parse(text);
      } catch {
        importedRaw = parseModelJson(text);
      }
      const coerced = coerceImportedReport(importedRaw);
      for (const w of coerced.warnings) note(`导入：${w}`);
      const parsed = reportSchema.safeParse(coerced.value);
      if (!parsed.success) throw new Error(`report.json 不符合契约（已尽量修正仍不行）：${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
      const report = parsed.data as unknown as Report;
      // 附件按文件名对上上传的 assets
      for (const a of report.attachments ?? []) {
        const key = assetKeys.get(a.file) ?? null;
        a.assetKey = key;
        if (key) a.present = true;
      }
      const roster = (report.stats?.bySpeaker ?? []).map((s) => ({ account: s.account, name: s.name, count: s.count, substantive: s.count }));
      const matches = await matchRosterToUsers(roster);
      // 附件不再自动进全站知识库（owner 2026-10-21：「月报里的内容直接发到 library 会变得很乱」）——留在报告里，
      // 由所有者按需「分享到知识库」（library.ts#ingestOneReportAsset）。
      await setStage(id, 'ready', '完成', 100, { reportJson: report as unknown as Prisma.InputJsonValue, authorMatches: matches as unknown as Prisma.InputJsonValue, title: report.title, subject: report.subject, model: report.generator?.model ?? modelName, error: null });
      await notifyReportReady(id); // 提醒失败绝不影响状态（notifications.ts 自己吞错）
      return true;
    }

    // ── 1. 解析 ───────────────────────────────────────────────────────────
    let chat: ParsedChat | null = (row.messagesJson as unknown as ParsedChat | null) ?? null;
    if (!chat) {
      await setStage(id, 'parsing', '解析聊天记录', 5);
      const text = await readKey(row.sourceKey);
      if (!text) throw new Error('读不到上传的聊天记录文件');
      const manifestText = await readKey(row.manifestKey);
      const manifest = manifestText ? parseManifest(manifestText) : null;
      const names = row.namesJson && typeof row.namesJson === 'object' && !Array.isArray(row.namesJson) ? (row.namesJson as Record<string, string>) : undefined;
      const parseOpts = { subject: row.subject || undefined, from, to, manifest, names, presentFiles: new Set(assetKeys.keys()), sourceName: row.sourceName ?? '' };
      if (parseRawMessages(text).raw.some((m) => Number.isFinite(m.ts))) {
        chat = parseChat(text, parseOpts);
      } else {
        // 确定性解析器一条都认不出：让模型看文件开头推断行头格式，再用它确定性地切分全文（infer-format.ts）
        await setStage(id, 'parsing', '解析器没认出格式，让模型推断记录的行头格式', 6);
        const spec = await inferLineFormat(text);
        const raw = spec ? splitWithSpec(text, spec) : [];
        if (!raw.length) throw new Error(describeUnparsed(text, row.sourceName ?? ''));
        note(`模型推断的格式：${spec?.note ?? spec?.lineRegex ?? ''}（切出 ${raw.length} 条）`);
        chat = parseChat(text, { ...parseOpts, raw });
      }
      const matches = await matchRosterToUsers(chat.roster);
      await setStage(id, 'parsing', `解析完成：${chat.messages.length} 条消息，${chat.roster.length} 位发言人`, 10, {
        messagesJson: chat as unknown as Prisma.InputJsonValue,
        authorMatches: matches as unknown as Prisma.InputJsonValue,
        subject: chat.subject,
      });
    }
    const stats = computeStats(chat);
    const index = indexChat(chat);
    const state: ClusterJson = { ...emptyClusterJson(), ...((row.clusterJson as unknown as Partial<ClusterJson> | null) ?? {}) };
    const save = async (status: ZoneReportStatus, stage: string, progress: number) =>
      setStage(id, status, stage, progress, { clusterJson: state as unknown as Prisma.InputJsonValue, model: modelName });

    // ── 2. 聚类 ───────────────────────────────────────────────────────────
    if (!state.cluster.themes.length) {
      await save('clustering', '模型归类主题', 15);
      const { parts } = buildDigest(chat, stats);
      if (parts.length === 1) {
        const r = await callJson({
          step: '聚类',
          prompt: clusterPrompt(parts[0], ins),
          schema: clusterSchema,
          coerce: (raw) => coerceCluster(raw, chat!),
          validate: (v) => validateCluster(v, chat!),
          onExhausted: ({ value }) => (value ? autofixCluster(value, chat!) : fallbackCluster(chat!)),
          maxTokens: 6000,
        });
        state.cluster = r.value;
        state.warnings.push(...r.warnings);
      } else {
        const partial: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          await save('clustering', `模型归类主题（第 ${i + 1}/${parts.length} 片）`, 15 + Math.round((i / parts.length) * 10));
          const r = await callJson({
            step: `聚类分片 ${i + 1}`,
            prompt: clusterPrompt(parts[i], ins),
            schema: clusterSchema,
            coerce: (raw) => coerceCluster(raw, chat!),
            // 这一片没聚出来就先空着：合并后的覆盖率校验 / autofix 会把漏掉的消息凑成「其他讨论」
            onExhausted: ({ value }) => value ?? { themes: [], events: [], recap: [], skip: [] },
            maxTokens: 6000,
          });
          state.warnings.push(...r.warnings);
          if (r.value.themes.length) partial.push(JSON.stringify(r.value));
        }
        const merged = await callJson({
          step: '聚类合并',
          prompt: mergeClustersPrompt(partial),
          schema: clusterSchema,
          coerce: (raw) => coerceCluster(raw, chat!),
          validate: (v) => validateCluster(v, chat!),
          onExhausted: ({ value }) => (value ? autofixCluster(value, chat!) : fallbackCluster(chat!)),
          maxTokens: 8000,
        });
        state.cluster = merged.value;
        state.warnings.push(...merged.warnings);
      }
      await save('clustering', `归出 ${state.cluster.themes.length} 个主题`, 25);
    }

    // ── 3. 逐主题 + 活动花絮 + 要点 ───────────────────────────────────────
    const todo = state.cluster.themes.filter((t) => !state.themes[t.id]);
    if (todo.length || !state.recap || !state.overview) await save('summarizing', '模型逐主题写摘要', 30);
    let done = state.cluster.themes.length - todo.length;
    const total = state.cluster.themes.length;
    const queue = [...todo];
    const worker = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        const bundle = buildThemeBundle(chat!, t);
        const r = await callJson({
          step: `主题 ${t.id}`,
          prompt: themePrompt(bundle, ins),
          schema: themeSchema,
          coerce: (raw) => coerceTheme(raw, chat!, t, index),
          validate: (v) => validateTheme(v, chat!, state.cluster, index),
          // 形状对了只是校验不过：再过一遍 coerce（会按引用消息修发言人、丢无效引用）；一个都没有就用原文节选
          onExhausted: ({ value }) => {
            if (value) {
              const again = themeSchema.safeParse(coerceTheme(value, chat!, t, index).value);
              if (again.success && !validateTheme(again.data, chat!, state.cluster, index).errors.length) return again.data;
            }
            return fallbackTheme(t, chat!, index);
          },
          maxTokens: 8000,
        });
        state.themes[t.id] = { ...r.value, id: t.id };
        state.warnings.push(...r.warnings.map((w) => `${t.id}: ${w}`));
        done++;
        await save('summarizing', `主题摘要 ${done}/${total}：${t.title}`, 30 + Math.round((done / Math.max(1, total)) * 40));
      }
    };
    await Promise.all(Array.from({ length: Math.min(THEME_CONCURRENCY, queue.length || 1) }, worker));

    if (!state.recap) {
      const ev = buildListBundle(chat, state.cluster.events, '活动与通知（洞见烩 / Workshop / 会议）');
      const rc = buildListBundle(chat, state.cluster.recap, '非科研 · 快速 Recap（花絮 / 终端 / 杂项）');
      if (ev || rc) {
        await save('summarizing', '整理活动与花絮', 72);
        const r = await callJson({
          step: '活动与花絮',
          prompt: recapPrompt(ev, rc, ins),
          schema: recapSchema,
          coerce: (raw) => coerceRecap(raw, chat!, index),
          validate: (v) => validateRecap(v, chat!, index),
          onExhausted: ({ value }) => value ?? fallbackRecap(state.cluster.events, state.cluster.recap, chat!, index),
          maxTokens: 6000,
        });
        state.recap = r.value;
        state.warnings.push(...r.warnings);
      } else {
        state.recap = { recap: null, events: [] };
      }
      await save('summarizing', '活动与花絮完成', 75);
    }

    const themes = state.cluster.themes.map((t) => state.themes[t.id]).filter(Boolean);
    if (!state.overview) {
      await save('summarizing', '模型写本期要点', 78);
      const outline = buildOutline(themes, state.recap);
      const r = await callJson({
        step: '要点',
        prompt: overviewPrompt(outline, ins),
        schema: overviewSchema,
        coerce: (raw) => coerceOverview(raw, themes),
        validate: (v) => validateOverview(v, new Set(themes.map((t) => t.id))),
        onExhausted: ({ value }) => value ?? fallbackOverview(themes),
        maxTokens: 4000,
      });
      state.overview = r.value;
      state.warnings.push(...r.warnings);
      await save('summarizing', '要点完成', 82);
    }

    // ── 4. 装配 ───────────────────────────────────────────────────────────
    await save('assembling', '装配报告与配图', 85);
    const report = assembleReport({
      chat,
      stats,
      cluster: state.cluster,
      themes,
      recap: state.recap,
      overview: state.overview,
      kind: row.kind as ReportKind,
      title: row.title,
      from,
      to,
      model: modelName,
      assetKeys,
    });
    // ── 5. 完成（附件不再自动收录进知识库——按需分享，见 library.ts） ─────────────
    await setStage(id, 'ready', `完成：${report.themes.length} 个主题 · ${report.themes.reduce((n, t) => n + t.viewpoints.length, 0)} 条观点${state.warnings.length ? ` · ${state.warnings.length} 条校验警告` : ''}`, 100, { error: null, model: modelName });
    await notifyReportReady(id);
    return true;
  } catch (e) {
    const err = e as Error;
    const message = e instanceof ReportLlmError ? err.message : `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}`;
    console.error('[zone-report] failed', id, message);
    await prisma.zoneReport.update({ where: { id }, data: { status: 'failed', error: message.slice(0, 2000), heartbeatAt: new Date() } }).catch(() => {});
    await notifyReportReady(id);
    return false;
  }
}
