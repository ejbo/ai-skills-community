// 收录任务 (添加内容) — the pure half of the background ingest flow (owner, 2026-10-09:
// 「提取链接或上传文档时异步进行，可以收起到右下角继续浏览，有进度条和描述，
// 完成后从通知栏提醒」).
//
// A job is client-side state that outlives the dialog: it owns the request, then
// polls the doc until extraction AND the AI 导读 have settled. These helpers turn a
// job into what the UI shows (stage key, step index, bar %), so the dialog, the dock
// and the tests agree.

export type IngestKind = 'url' | 'file';

export type IngestStage =
  /** File only: bytes going up (determinate %). */
  | 'uploading'
  /** URL only: the server is fetching the page and extracting the article. */
  | 'fetching'
  /** File only: bytes are up, the server is extracting. */
  | 'parsing'
  /** Row exists; AI is reading (导读) — polled. */
  | 'indexing'
  /** Everything settled: extraction ok; `aiOk` says whether the 导读 landed. */
  | 'done'
  /** Extraction (or the request itself) failed. */
  | 'failed'
  /** The URL / file was already in the library — nothing ran. */
  | 'existing';

export interface IngestJob {
  id: string;
  kind: IngestKind;
  /** What the user typed or picked: the URL or the file name (title replaces it once known). */
  label: string;
  stage: IngestStage;
  /** Upload percent (file, 0–100) — null when not determinate. */
  percent: number | null;
  docId: string | null;
  slug: string | null;
  title: string | null;
  aiOk: boolean | null;
  error: string | null;
  startedAt: number;
}

export const INGEST_STEPS = ['transfer', 'parse', 'ai'] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];

export function isActiveJob(job: Pick<IngestJob, 'stage'>): boolean {
  return job.stage === 'uploading' || job.stage === 'fetching' || job.stage === 'parsing' || job.stage === 'indexing';
}

/** Which of the three steps a job is on (index into INGEST_STEPS); 3 = all done. */
export function stepIndex(job: Pick<IngestJob, 'stage'>): number {
  switch (job.stage) {
    case 'uploading':
    case 'fetching':
      return 0;
    case 'parsing':
      return 1;
    case 'indexing':
      return 2;
    default:
      return 3;
  }
}

/**
 * Overall bar percent. The upload is the only measurable part, so it owns the
 * first third; the other two thirds advance by step. A finished job is 100.
 */
export function jobPercent(job: Pick<IngestJob, 'stage' | 'percent'>): number {
  switch (job.stage) {
    case 'uploading':
      return Math.round(Math.min(100, Math.max(0, job.percent ?? 0)) / 3);
    case 'fetching':
      return 15;
    case 'parsing':
      return 45;
    case 'indexing':
      return 75;
    default:
      return 100;
  }
}

/** i18n key (library_ui) for the stage line, with the upload percent folded in. */
export function stageKey(job: Pick<IngestJob, 'stage' | 'percent' | 'aiOk'>): string {
  switch (job.stage) {
    case 'uploading':
      return job.percent !== null && job.percent < 100 ? 'stage_uploading_pct' : 'stage_uploading';
    case 'fetching':
      return 'stage_fetching';
    case 'parsing':
      return 'stage_parsing';
    case 'indexing':
      return 'stage_indexing';
    case 'done':
      return job.aiOk === false ? 'stage_done_no_ai' : 'stage_done';
    case 'failed':
      return 'stage_failed';
    case 'existing':
      return 'stage_existing';
  }
}

/** A poll answer from GET /api/library/docs/[id] → the job's next stage, or null to keep polling. */
export function settleFromPoll(doc: {
  status: string;
  aiIndexState: string;
  processingError?: string | null;
}): { stage: 'done' | 'failed'; aiOk: boolean | null; error: string | null } | null {
  if (doc.status === 'failed') return { stage: 'failed', aiOk: null, error: doc.processingError ?? null };
  if (doc.status !== 'ready') return null;
  if (doc.aiIndexState === 'ready') return { stage: 'done', aiOk: true, error: null };
  if (doc.aiIndexState === 'failed') return { stage: 'done', aiOk: false, error: null };
  return null; // none | running — the 导读 is still coming
}

/** Jobs the dock should still show: anything active, plus finished ones not yet dismissed. */
export function summarize(jobs: readonly Pick<IngestJob, 'stage'>[]): { active: number; done: number; failed: number } {
  let active = 0;
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    if (isActiveJob(j)) active += 1;
    else if (j.stage === 'failed') failed += 1;
    else done += 1;
  }
  return { active, done, failed };
}
