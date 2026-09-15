// 技术专区 composer — the body figures the settings sheet shows (「{n} 字 · 约 N 分钟阅读」).
//
// A plain module (not the 'use client' composer) so the rule is unit-testable
// and cannot drift: 字数 is `richTextLength`, the SAME function behind the
// editor's own `n / max` counter, so the two numbers on one screen always agree.
// It used to be the raw markdown length — colouring, sizing and re-fonting two
// words stores ~120 characters of `<span data-*>` markup, and the sheet said
// 147 字 beside an editor reading 30. Reading time counts the plain text
// (estimateReadMinutes), which is also what the published post shows.

import { richTextLength } from '@/lib/markdown-text';
import { estimateReadMinutes } from '@/lib/zones/shared';

export interface ComposerBodyStats {
  /** Visible characters — identical to RichTextEditor's counter. */
  chars: number;
  readMinutes: number;
}

export function composerBodyStats(bodyMd: string): ComposerBodyStats {
  return { chars: richTextLength(bodyMd), readMinutes: estimateReadMinutes(bodyMd) };
}
