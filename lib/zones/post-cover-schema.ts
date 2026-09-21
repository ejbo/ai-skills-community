// 封面版式 / 裁切 as REQUEST fields — the zod half of lib/zones/post-cover.ts, in a
// module of its own for two reasons: post-cover.ts stays dependency-free (the
// composer-side code and the unit tests import it without pulling zod in), and
// BOTH write routes (POST via `zonePostInputSchema` in post-queries.ts, PATCH via
// its own `patchSchema`) validate with the SAME closed value sets without the
// PATCH route having to import them from post-queries — route tests mock that
// module with a fixed export list.
//
// A value the crop editor can produce is a value both routes accept; anything
// else is a 400 `invalid_input` (the issue message names the field), never a
// silently "fixed" crop. `.max(16)` bounds the string before the regex sees it.

import { z } from 'zod';
import { parseCoverFramingInput } from './post-cover';

export const coverAspectSchema = z
  .string()
  .max(16)
  .refine((v) => parseCoverFramingInput({ coverAspect: v }) !== null, { message: 'invalid_cover_aspect' });

export const coverPosSchema = z
  .string()
  .max(16)
  .refine((v) => parseCoverFramingInput({ coverPos: v }) !== null, { message: 'invalid_cover_pos' });
