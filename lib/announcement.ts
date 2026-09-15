import { markdownToPlainText } from '@/lib/markdown-text';

// Derive a short plain-text summary from an announcement's markdown body, for
// the notification/email preview (the full body is rendered on the detail page).
// lib/markdown-text.ts owns the rules: formatting spans, images and entities
// never reach the bell or the email, a code block next to prose is dropped (a
// code-only body shows its first code line), and truncation is code-point safe.
export function plainSummary(md: string, max = 160): string {
  return markdownToPlainText(md, { max });
}
