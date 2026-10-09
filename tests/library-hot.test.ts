import { describe, expect, it } from 'vitest';
import { decayWeight, hotScore, HOT_HALF_LIFE_DAYS, HOT_WEIGHTS, HOT_WINDOW_DAYS } from '@/lib/library/hot-shared';
import { activityHref } from '@/lib/library/activity-shared';

const DAY = 86_400_000;

describe('最热 scoring', () => {
  it('decays by half every HOT_HALF_LIFE_DAYS and is 1 for "now"', () => {
    expect(decayWeight(0)).toBe(1);
    expect(decayWeight(-5)).toBe(1);
    expect(decayWeight(HOT_HALF_LIFE_DAYS * DAY)).toBeCloseTo(0.5, 6);
    expect(decayWeight(2 * HOT_HALF_LIFE_DAYS * DAY)).toBeCloseTo(0.25, 6);
    expect(decayWeight(Number.NaN)).toBe(1);
  });

  it('recent activity beats the same activity a week ago; comments beat views; old events do not count', () => {
    const today = hotScore([{ kind: 'view', ageMs: 0 }, { kind: 'view', ageMs: 0 }]);
    const lastWeek = hotScore([{ kind: 'view', ageMs: 6 * DAY }, { kind: 'view', ageMs: 6 * DAY }]);
    expect(today).toBeGreaterThan(lastWeek);
    expect(hotScore([{ kind: 'comment', ageMs: 0 }])).toBe(HOT_WEIGHTS.comment);
    expect(hotScore([{ kind: 'comment', ageMs: DAY }])).toBeGreaterThan(hotScore([{ kind: 'view', ageMs: 0 }]));
    expect(hotScore([{ kind: 'shelf', ageMs: (HOT_WINDOW_DAYS + 1) * DAY }])).toBe(0);
  });

  it('a fresh doc with no readers still scores a little (so it is not invisible for a week)', () => {
    expect(hotScore([{ kind: 'fresh', ageMs: 0 }])).toBe(HOT_WEIGHTS.fresh);
  });
});

describe('activityHref', () => {
  it('points a comment at the doc page and a note at the reader chapter + mark', () => {
    expect(activityHref({ kind: 'comment', id: 'c1', slug: '大模型-推理' })).toBe(
      '/library/%E5%A4%A7%E6%A8%A1%E5%9E%8B-%E6%8E%A8%E7%90%86?focus=c1',
    );
    expect(activityHref({ kind: 'note', id: 'h9', slug: 'attention', chapterIndex: 3 })).toBe(
      '/library/attention/read?ch=3&hl=h9',
    );
    expect(activityHref({ kind: 'note', id: 'h9', slug: 'attention', chapterIndex: null })).toBe(
      '/library/attention/read?ch=0&hl=h9',
    );
  });
});
