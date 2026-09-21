// 站内翻译 — the loader contract (server-side). Kept apart from sources.ts so the
// service and its tests can depend on the SHAPE without importing every domain's
// query layer.
//
// THE RULE (docs/translation-design.md §3.5): a loader is the gate. The route
// never accepts text from the client — it accepts `{kind, id}`, and the loader
// (1) reads the row itself and (2) re-runs the surface's OWN read gate by calling
// the SAME helper that surface's list/detail route uses. "Translatable exactly
// when readable": null ⇒ 404, indistinguishable from a missing row. A loader must
// also re-check that the row belongs to the parent it hangs under (a comment of a
// hidden vote entry, a reply of a deleted topic), exactly like the like-routes do.

import type { PermissionHolder } from '@/lib/permissions';
import type { FieldName } from './shared';

/** `session.user` as the routes have it — enough for `can()` and every `domainViewer`. null = anonymous. */
export type TranslateViewer = ({ id: string } & PermissionHolder) | null;

/** The translatable text of one item, keyed like the kind's `fields` in TRANSLATE_KINDS. Omit empty fields. */
export type SourceFields = Partial<Record<FieldName, string>>;

export type TranslateLoader = (id: string, viewer: TranslateViewer) => Promise<SourceFields | null>;
