// 富文本长度上限 — the zod half of the visible-length contract.
//
// A comment/reply/review cap is about what the reader SEES. The editor's
// formatting spans (lib/rich-marks.ts) add ~30 raw characters per coloured
// phrase, so a raw `.max(2000)` rejected formatted comments whose text was far
// shorter while the counter said they fit. Every capped rich-text body
// therefore validates two things, both decided in lib/markdown-text.ts and
// mirrored by the client tooLong checks through `isRichTextTooLong`:
//   • visible length (`richTextLength`) ≤ limit;
//   • raw length ≤ limit × RICH_TEXT_RAW_CEILING_FACTOR — markup is discounted,
//     not free, so a body of nothing but nested spans is still refused.
// The error is zod's own `too_big` issue with the VISIBLE limit, so routes that
// surface `issues[0].message` say exactly what they said before (pass `message`
// where the raw `.max(n, message)` carried a user-facing one).
//
// The rule that makes this a contract rather than a helper: EVERY field edited
// by a `RichTextEditor` with a `maxLength` validates through this function, on
// every write path (create AND edit, member AND admin), and nothing after zod
// may `.slice()` the body back to a raw length — the counter shows visible
// length, so a raw cap anywhere is a save that fails (400) or silently loses its
// tail while the counter says it fits. tests/rich-text-limit-surfaces.test.ts
// pins both halves.

import { z } from 'zod';
import { isRichTextTooLong } from '@/lib/markdown-text';

/**
 * Cap a (possibly trimmed / min-checked) string schema by visible rich-text
 * length. Chain `.default()` / `.optional()` AFTER this call.
 *
 *   bodyMd: withRichTextLimit(z.string().trim().min(1), 2000)
 *   descriptionMd: withRichTextLimit(z.string(), 20000, '活动介绍过长').default('')
 */
export function withRichTextLimit(schema: z.ZodString, limit: number, message?: string) {
  return schema.superRefine((value, ctx) => {
    // isRichTextTooLong checks the raw ceiling first, so a huge body is refused
    // without being scanned; both failures report the VISIBLE limit the author
    // was shown. Same function as every client gate — they cannot disagree.
    if (isRichTextTooLong(value, limit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: limit,
        type: 'string',
        inclusive: true,
        ...(message !== undefined ? { message } : {}),
      });
    }
  });
}
