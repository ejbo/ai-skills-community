import { describe, expect, it } from 'vitest';
import { isActiveJob, jobPercent, settleFromPoll, stageKey, stepIndex, summarize } from '@/lib/library/ingest-shared';

describe('收录任务 stages', () => {
  it('maps stages to steps and a monotone bar', () => {
    expect(stepIndex({ stage: 'uploading' })).toBe(0);
    expect(stepIndex({ stage: 'fetching' })).toBe(0);
    expect(stepIndex({ stage: 'parsing' })).toBe(1);
    expect(stepIndex({ stage: 'indexing' })).toBe(2);
    expect(stepIndex({ stage: 'done' })).toBe(3);
    const bar = [
      jobPercent({ stage: 'uploading', percent: 0 }),
      jobPercent({ stage: 'uploading', percent: 60 }),
      jobPercent({ stage: 'parsing', percent: 100 }),
      jobPercent({ stage: 'indexing', percent: null }),
      jobPercent({ stage: 'done', percent: null }),
    ];
    expect(bar).toEqual([0, 20, 45, 75, 100]);
    expect(jobPercent({ stage: 'fetching', percent: null })).toBe(15);
  });

  it('picks the stage line, folding the upload percent in', () => {
    expect(stageKey({ stage: 'uploading', percent: 42, aiOk: null })).toBe('stage_uploading_pct');
    expect(stageKey({ stage: 'uploading', percent: 100, aiOk: null })).toBe('stage_uploading');
    expect(stageKey({ stage: 'indexing', percent: null, aiOk: null })).toBe('stage_indexing');
    expect(stageKey({ stage: 'done', percent: null, aiOk: true })).toBe('stage_done');
    expect(stageKey({ stage: 'done', percent: null, aiOk: false })).toBe('stage_done_no_ai');
    expect(stageKey({ stage: 'existing', percent: null, aiOk: null })).toBe('stage_existing');
  });

  it('settles only when extraction AND the 导读 are decided', () => {
    expect(settleFromPoll({ status: 'processing', aiIndexState: 'none' })).toBeNull();
    expect(settleFromPoll({ status: 'ready', aiIndexState: 'running' })).toBeNull();
    expect(settleFromPoll({ status: 'ready', aiIndexState: 'none' })).toBeNull();
    expect(settleFromPoll({ status: 'ready', aiIndexState: 'ready' })).toEqual({ stage: 'done', aiOk: true, error: null });
    expect(settleFromPoll({ status: 'ready', aiIndexState: 'failed' })).toEqual({ stage: 'done', aiOk: false, error: null });
    expect(settleFromPoll({ status: 'failed', aiIndexState: 'none', processingError: '无法提取正文' })).toEqual({
      stage: 'failed',
      aiOk: null,
      error: '无法提取正文',
    });
  });

  it('counts active / done / failed for the dock header', () => {
    expect(isActiveJob({ stage: 'parsing' })).toBe(true);
    expect(isActiveJob({ stage: 'existing' })).toBe(false);
    expect(summarize([{ stage: 'uploading' }, { stage: 'indexing' }, { stage: 'done' }, { stage: 'failed' }, { stage: 'existing' }])).toEqual({
      active: 2,
      done: 2,
      failed: 1,
    });
  });
});
