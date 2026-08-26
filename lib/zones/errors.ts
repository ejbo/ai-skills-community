// 技术专区 — the shared error type, in a module of its own so every query layer
// (queries.ts / post-queries.ts / columns.ts) can throw it without importing a
// sibling that imports it back. `lib/zones/queries.ts` re-exports the class, so
// the existing `import { ZoneError } from '@/lib/zones/queries'` in the API
// routes keeps working (same class object ⇒ `instanceof` is unaffected).

export class ZoneError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ZoneError';
  }
}
