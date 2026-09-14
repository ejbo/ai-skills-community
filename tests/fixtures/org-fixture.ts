// A non-empty 研究所 → 实验室 chart for the org tests. Production ships an EMPTY
// `INSTITUTES` (lib/org.ts, owner decision 2026-09-11: the chart is whatever the
// 版块 say it is), so the merge/order/placeholder RULES can only be exercised
// against a fixture. Tests mock '@/lib/org' with `createOrg(ORG_FIXTURE)`.
import type { Institute } from '@/lib/org';

export const ORG_FIXTURE: Institute[] = [
  { name: '温哥华研究所', labs: ['Computing Data Application Acceleration Laboratory', 'Graphics Technology Laboratory'], image: '/labs/vancouver.jpg' },
  { name: '多伦多研究所', labs: ['Toronto NLP Lab'] },
  { name: '渥太华研究所', labs: [] },
  { name: '滑铁卢研究所', labs: [] },
  { name: '埃德蒙顿研究所', labs: [] },
  { name: '蒙特利尔研究所', labs: [] },
];
