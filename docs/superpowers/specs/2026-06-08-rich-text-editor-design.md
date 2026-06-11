# Rich Text Editor (WYSIWYG, Markdown-native) — Design

**Date:** 2026-06-08
**Branch:** feat/video-board
**Status:** Approved by user; implemented same session.

## Goal

Give users a real rich-text (WYSIWYG) editor — bold/italic/strike, headings, links,
lists, quotes, code, **and inline image upload (toolbar pick / drag / paste)** — for
the app's free-form text fields, starting with skill *overview* and video
*description*, and extending to comment/review areas. Build it **once** as a reusable
component so any future markdown field is a one-line drop-in.

## Core decision: stay Markdown-native (zero migration)

The whole app is markdown-native: every long-text field is named `*Md`, stored as a
Markdown string, rendered through one shared sanitizing pipeline
(`components/MarkdownRenderer.tsx` → react-markdown + remark-gfm + rehype-raw +
rehype-highlight + rehype-sanitize), and AI-assist already emits Markdown.

The editor therefore reads/writes **Markdown**. Consequences:

- Prisma schema, API zod validation, render pipeline, and AI-assist are **unchanged**.
- Existing markdown content loads and keeps editing cleanly. **No data migration.**
- Users see WYSIWYG; the DB still stores clean Markdown.

Rejected: switching storage to HTML (breaks AI-assist's markdown output + the render
pipeline + needs a migration).

## Editor choice

**Tiptap v2** (matches React 18.3 / Next 14.2) + `tiptap-markdown` for Markdown I/O.
Chosen for the largest ecosystem and easiest extension. `tiptap-markdown` is proven on
v2; v3 is intentionally avoided to dodge version friction.

Packages: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`,
`@tiptap/extension-image`, `@tiptap/extension-placeholder`, `tiptap-markdown` (all v2.x).

StarterKit covers bold/italic/strike/code/headings/lists/blockquote/code-block/HR/
undo-redo; Link, Image, Placeholder added on top.

## Reusable component: `components/RichTextEditor.tsx`

Client component, controlled, drop-in for the existing `value`/`onChange` textareas:

```tsx
<RichTextEditor value={md} onChange={setMd} placeholder="…" variant="full" />
```

- **Props:** `value: string` (markdown), `onChange: (md: string) => void`,
  `placeholder?`, `variant?: 'full' | 'compact'`, `maxLength?`, `className?`,
  `disabled?`.
- **SSR-safe:** `'use client'`, `immediatelyRender: false`, `if (!editor) return null`.
- **Markdown I/O:** `Markdown.configure({ html: true, transformPastedText: true })`;
  emit on update via `editor.storage.markdown.getMarkdown()`.
- **Controlled sync:** on `update` → `onChange(getMarkdown())`. A `useEffect` watches
  `value`; if it differs from current `getMarkdown()` (external change such as AI-assist
  filling the field, or a form reset) it calls `editor.commands.setContent(value)`
  without emitting — prevents cursor jump on every keystroke.
- **Toolbar** (lucide-react icons, active-state highlight):
  - `full`: bold, italic, strike, inline code, H1/H2/H3, bullet list, ordered list,
    blockquote, code block, link, image, horizontal rule, undo, redo.
  - `compact` (comments/reviews): bold, italic, strike, link, bullet list, image.
- **Link UX:** `window.prompt` for URL (v1); applies/removes link mark.
- **Image UX:** hidden file input + drag-drop + paste, all routed through one upload
  helper → insert image node. Shows an uploading indicator; ignores non-image drops.
- **Styling:** editor surface matches the design system; the editable area uses `prose`
  so WYSIWYG ≈ final `MarkdownRenderer` output.

## Image upload & storage

Mirror the video local-disk streaming model, but a **generic, login-gated** route
(video's upload route is admin-only; skill authors are not necessarily admins).

- `lib/base-path.ts` — neutral `withBasePath` (so the shared renderer needn't import
  from the video module). Video keeps its own copy (left untouched).
- `lib/uploads/image-storage.ts` — local disk under `LOCAL_STORAGE_DIR/uploads/images`;
  `nanoid` unguessable keys; MIME allowlist (jpeg/png/webp/avif/gif); **path-traversal
  guard**; `imagePublicUrl(key)` → root-relative `/api/uploads/<key>`; streaming writer
  with a byte cap.
- `POST /api/uploads/image` — **requires login** (any authenticated user). Raw body
  upload (`content-type` + `x-filename` headers, same convention as video upload);
  validates image MIME + 10 MB cap; returns `{ url }` (root-relative). `runtime=nodejs`,
  `dynamic=force-dynamic`.
- `GET /api/uploads/[...key]` — serves the file from disk with correct content-type and
  `cache-control: public, max-age=31536000, immutable` (keys are content-unique).
  **Ungated** so embedded images render in any context (incl. anonymous skill views).
  Path-traversal guarded.
  - Known tradeoff: an image embedded in a `private`/`restricted` skill is reachable by
    anyone holding its unguessable URL. Accepted for an internal community v1.

## basePath correctness (subpath deploys)

Convention is **store root-relative, apply basePath at render**. Stored markdown holds
`/api/uploads/<key>`.

- Client upload fetch uses `withBasePath('/api/uploads/image')`.
- `MarkdownRenderer` gets an `img` component override applying `withBasePath(src)` (+
  `loading="lazy"`) — fixes public render under a subpath deploy.
- Tiptap `Image` extension `renderHTML` override applies `withBasePath` to the *displayed*
  src only; node attrs stay root-relative, so `getMarkdown()` output stays portable.

## Rendering & sanitization

Keep `MarkdownRenderer`. Explicitly extend the rehype-sanitize schema in `lib/markdown.ts`
to guarantee `img` (`src`/`alt`/`title`/`width`/`height`) and `a` (`href`/`title`/
`target`/`rel`) survive. Relative URLs already pass the protocol check. Sanitize remains
the trust boundary (scripts/handlers/`javascript:` still stripped).

## Integration points

| Surface | Input (textarea → RichTextEditor) | Variant | Render change |
| --- | --- | --- | --- |
| Skill overview | `app/skills/_components/SkillForm.tsx` (`overview`→`descriptionMd`) | full | none (already MarkdownRenderer) |
| Video description | `components/video/VideoForm.tsx` (`descriptionMd`) | full | none (already MarkdownRenderer) |
| Video comment create | `components/video/CommentComposer.tsx` (`bodyMd`) | compact | `CommentItem.tsx:199` plain → MarkdownRenderer (compact) |
| Video comment edit | `components/video/CommentItem.tsx` (`bodyMd`) | compact | same as above |
| Skill review | `app/skills/[slug]/ReviewForm.tsx` (`bodyMd`) | compact | `ReviewsTab.tsx:120` + author reply plain → MarkdownRenderer (compact) |

- AI-assist for skill overview keeps working via the controlled-sync effect.
- Char limits (2000 for comments/reviews) unchanged; an image's markdown (`![](url)`) is
  short and fits.

## Out of scope (YAGNI for v1)

- Access-request `message` (short, private admin-only note) stays a plain textarea.
- Video `transcriptText` stays a plain textarea (raw transcript).
- Comparison `bodyMd`, version `changelogMd`: not converted now, but a 1-line drop-in
  later thanks to the reusable component.
- No tables/mentions/real-time-collab/image-cropping/embedded-video in v1.

## Testing

- **vitest unit tests** (node env) for `lib/uploads/image-storage.ts`: MIME allowlist,
  key generation, **path-traversal guard** (security-critical), public-URL shape.
- Sanitize-schema test: a sample with `<img>`/`<a>` survives; `<script>`/`onerror` are
  stripped.
- Editor markdown round-trip + image insertion verified via `pnpm build` (typecheck/SSR)
  and a dev run (adding jsdom for ProseMirror unit tests is avoided as scope creep).
- Final adversarial multi-agent review pass (security of upload/serve, XSS, basePath,
  round-trip).

## Verification gates

`pnpm typecheck` + `pnpm test` + `pnpm build` all green before completion.
