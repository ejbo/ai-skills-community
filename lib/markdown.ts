import { defaultSchema } from 'rehype-sanitize';

const baseAttributes = defaultSchema.attributes ?? {};

/**
 * GitHub-style sanitize schema, extended to keep the class names that
 * rehype-highlight adds (`hljs`, `language-*`, and `hljs-*` token spans) so
 * syntax highlighting survives sanitization. Scripts, inline event handlers,
 * `javascript:` URLs, and disallowed tags are still stripped — this is the
 * trust boundary for user-supplied markdown/HTML.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseAttributes,
    code: [...(baseAttributes.code ?? []), 'className'],
    span: [...(baseAttributes.span ?? []), 'className'],
    pre: [...(baseAttributes.pre ?? []), 'className'],
  },
};
