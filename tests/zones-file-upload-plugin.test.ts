// @vitest-environment jsdom
// Headless test of the in-editor upload placeholder (the REAL plugin + embed
// node, minus React nodeviews): a widget decoration that rides the document
// while a file uploads, then ONE undoable insert of `[embed:file:<key>]` at
// the mapped position. Nothing touches the document until the upload resolves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ContentEmbedBase, removeContentEmbeds } from '@/components/zones/embeds/embed-node-extension';
import {
  FileUploadPlaceholder,
  blockPosFor,
  findPlaceholderPos,
  startFileUpload,
  uploadKey,
  type FileUploadDeps,
} from '@/components/zones/embeds/file-upload-plugin';
import { UploadError, type AttachmentDraft } from '@/components/zones/attachments/upload-core';
import { EMBED_TOKEN_RE } from '@/lib/zones/shared';

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      ContentEmbedBase,
      FileUploadPlaceholder.configure({ labels: { uploading: 'up', queued: 'queued', failed: 'failed', cancel: 'cancel', retry: 'retry' } }),
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
    content,
  });
}

const nodes = (ed: Editor) => {
  const out: { pos: number; kind: string; ref: string }[] = [];
  ed.state.doc.descendants((n, pos) => {
    if (n.type.name === 'contentEmbed') out.push({ pos, kind: String(n.attrs.kind), ref: String(n.attrs.ref) });
    return true;
  });
  return out;
};
const ownLine = (md: string) => md.split('\n').some((line) => EMBED_TOKEN_RE.test(line));
const placeholders = (ed: Editor) => uploadKey.getState(ed.state)?.find().length ?? 0;
const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const KEY = 'file/abc.pdf';
const file = () => new File(['%PDF'], 'abc.pdf', { type: 'application/pdf' });
const draft = (key = KEY): AttachmentDraft => ({
  id: null,
  key,
  kind: 'file',
  url: `/api/zones/media/${key}`,
  name: 'abc.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 4,
  width: null,
  height: null,
  posterUrl: null,
  ext: 'pdf',
  previewStatus: 'none',
  previewUrl: null,
});

function deps(upload: FileUploadDeps['upload']) {
  const done: AttachmentDraft[] = [];
  const errors: unknown[] = [];
  const busy: boolean[] = [];
  const d: FileUploadDeps = {
    upload,
    onDone: (x) => done.push(x),
    onError: (_f, e) => errors.push(e),
    onBusy: (b) => busy.push(b),
  };
  return { d, done, errors, busy };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('blockPosFor', () => {
  it('lifts an in-block position to the block boundary after it and keeps depth-0 positions', () => {
    const ed = makeEditor('first\n\nsecond');
    // doc = p('first')[0..7] p('second')[7..15]
    expect(blockPosFor(ed.state, 3)).toBe(7);
    expect(blockPosFor(ed.state, 9)).toBe(15);
    expect(blockPosFor(ed.state, 7)).toBe(7);
    expect(blockPosFor(ed.state, 0)).toBe(0);
    expect(blockPosFor(ed.state, 999)).toBe(15); // clamped to the doc end
    ed.destroy();
  });
});

describe('upload placeholder', () => {
  it('rides the document while uploading, never serializes, then inserts ONE undoable embed at the mapped position', async () => {
    const ed = makeEditor('first\n\nsecond');
    const up = deferred<{ key: string; draft: AttachmentDraft }>();
    const { d, done, busy } = deps(() => up.promise);
    const before = ed.storage.markdown.getMarkdown();

    const { id } = startFileUpload(ed.view, file(), 3, d);
    expect(busy).toEqual([true]);
    expect(placeholders(ed)).toBe(1);
    expect(findPlaceholderPos(ed.state, id)).toBe(7);
    // The document itself is untouched — no token, nothing for autosave to store.
    expect(ed.storage.markdown.getMarkdown()).toBe(before);
    expect(ed.storage.markdown.getMarkdown()).not.toContain('[embed');
    // The widget is in the DOM with its progress bar.
    const el = ed.view.dom.querySelector<HTMLElement>(`.rte-upload[data-id="${id}"]`);
    expect(el?.dataset.state).toBe('uploading');
    expect(el?.querySelector('.rte-upload-fill')).toBeTruthy();

    // Typing ABOVE the placeholder moves it with its block.
    ed.commands.insertContentAt(1, 'XYZ');
    expect(findPlaceholderPos(ed.state, id)).toBe(10);
    expect(ed.storage.markdown.getMarkdown()).not.toContain('[embed');

    // Let the typing close its history group so the insert is its own step.
    await new Promise((r) => setTimeout(r, 600));
    up.resolve({ key: KEY, draft: draft() });
    await tick();
    await tick();

    expect(done).toHaveLength(1);
    expect(busy).toEqual([true, false]);
    expect(placeholders(ed)).toBe(0);
    expect(nodes(ed)).toEqual([{ pos: 10, kind: 'file', ref: KEY }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    expect(out).toContain(`[embed:file:${KEY}]`);
    expect(out.startsWith('XYZfirst')).toBe(true);

    // ONE undo removes the card and keeps the typed text.
    ed.commands.undo();
    expect(nodes(ed)).toEqual([]);
    expect(ed.storage.markdown.getMarkdown()).toContain('XYZfirst');
    expect(ed.storage.markdown.getMarkdown()).not.toContain('[embed');
    ed.destroy();
  }, 5000);

  it('a failed upload leaves the document unchanged, parks the widget in `failed` and cancel removes it', async () => {
    const ed = makeEditor('only');
    const { d, done, errors, busy } = deps(() => Promise.reject(new UploadError('upload_failed')));
    const before = ed.storage.markdown.getMarkdown();
    const { id, cancel } = startFileUpload(ed.view, file(), 2, d);
    await tick();
    await tick();
    expect(errors).toHaveLength(1);
    expect(done).toHaveLength(0);
    expect(busy).toEqual([true, false]);
    expect(ed.storage.markdown.getMarkdown()).toBe(before);
    expect(nodes(ed)).toEqual([]);
    const el = ed.view.dom.querySelector<HTMLElement>(`.rte-upload[data-id="${id}"]`);
    expect(el?.dataset.state).toBe('failed');
    expect(el?.querySelector<HTMLButtonElement>('.rte-upload-retry')?.hidden).toBe(false);
    cancel();
    expect(placeholders(ed)).toBe(0);
    expect(ed.storage.markdown.getMarkdown()).toBe(before);
    ed.destroy();
  });

  it('deleting the host block then resolving inserts nothing — but the draft still reaches the ledger', async () => {
    const ed = makeEditor('first\n\nsecond');
    const up = deferred<{ key: string; draft: AttachmentDraft }>();
    const { d, done } = deps(() => up.promise);
    const { id } = startFileUpload(ed.view, file(), 3, d); // boundary between the two paragraphs (7)
    expect(findPlaceholderPos(ed.state, id)).toBe(7);
    // A selection deleted ACROSS the boundary takes the placeholder with it.
    ed.commands.deleteRange({ from: 3, to: 10 });
    expect(findPlaceholderPos(ed.state, id)).toBeNull();
    up.resolve({ key: KEY, draft: draft() });
    await tick();
    await tick();
    expect(nodes(ed)).toEqual([]);
    expect(ed.storage.markdown.getMarkdown()).not.toContain('[embed');
    expect(done).toHaveLength(1); // the file stays a ledger draft — never an orphan
    ed.destroy();
  });

  it('a 429 parks the widget as `queued`, waits retry-after and retries the same file at the same position', async () => {
    vi.useFakeTimers();
    const ed = makeEditor('first\n\nsecond');
    let calls = 0;
    const { d, done, errors } = deps(async () => {
      calls += 1;
      if (calls === 1) throw new UploadError('rate_limited', 2000);
      return { key: KEY, draft: draft() };
    });
    const { id } = startFileUpload(ed.view, file(), 9, d);
    expect(findPlaceholderPos(ed.state, id)).toBe(15);
    await vi.advanceTimersByTimeAsync(0);
    const el = ed.view.dom.querySelector<HTMLElement>(`.rte-upload[data-id="${id}"]`);
    expect(el?.dataset.state).toBe('queued');
    expect(el?.querySelector('.rte-upload-state')?.textContent).toBe('queued');
    expect(nodes(ed)).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(0);
    expect(done).toHaveLength(1);
    expect(nodes(ed)).toEqual([{ pos: 15, kind: 'file', ref: KEY }]);
    ed.destroy();
  });

  it('uploads queue sequentially per editor and keep drop order', async () => {
    const ed = makeEditor('first');
    const first = deferred<{ key: string; draft: AttachmentDraft }>();
    const second = deferred<{ key: string; draft: AttachmentDraft }>();
    let calls = 0;
    const { d } = deps(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    startFileUpload(ed.view, file(), 2, d);
    startFileUpload(ed.view, new File(['x'], 'b.pdf', { type: 'application/pdf' }), 2, d);
    expect(placeholders(ed)).toBe(2);
    expect(calls).toBe(1); // the second waits for the first
    first.resolve({ key: 'file/a.pdf', draft: draft('file/a.pdf') });
    await tick();
    await tick();
    expect(calls).toBe(2);
    second.resolve({ key: 'file/b.pdf', draft: draft('file/b.pdf') });
    await tick();
    await tick();
    expect(nodes(ed).map((n) => n.ref)).toEqual(['file/a.pdf', 'file/b.pdf']);
    expect(placeholders(ed)).toBe(0);
    ed.destroy();
  });
});

// Why the composer's ledger deletes a body card through the editor instead of
// rewriting `bodyMd`: an external `value` change is answered by a whole-document
// `setContent`, and DecorationSet.map drops every widget inside the replaced
// range — the in-flight upload of ANOTHER file loses its placeholder, and when
// it lands `findPlaceholderPos` is null so the file never reaches the position
// its author picked. A 35-file drop sits in 排队中 for the whole rate-limit
// window, so this is a routine collision, not a corner case.
// A caret inside the 'tail' paragraph — the placeholder lands on the block
// boundary after it, in the MIDDLE of the document.
const midPos = (ed: Editor) => {
  let at = 0;
  ed.state.doc.descendants((n, pos) => {
    if (n.isTextblock && n.textContent === 'tail') at = pos + 2;
    return true;
  });
  return at;
};

describe('removing a body card while another file is still uploading', () => {
  it('setContent (the controlled sync) drops the in-flight placeholder', async () => {
    const ed = makeEditor('[embed:file:file/first.pdf]\n\ntail\n\nmore');
    await tick();
    const up = deferred<{ key: string; draft: AttachmentDraft }>();
    const { d, done } = deps(() => up.promise);
    // Dropped mid-document, the way a caret drop lands (a placeholder pinned at
    // the very end of the doc happens to survive the replace — most do not).
    const { id } = startFileUpload(ed.view, file(), midPos(ed), d);
    expect(findPlaceholderPos(ed.state, id)).not.toBeNull();

    // What a `bodyMd` rewrite comes back as.
    ed.commands.setContent(ed.storage.markdown.getMarkdown(), false);
    expect(placeholders(ed)).toBe(0);
    expect(findPlaceholderPos(ed.state, id)).toBeNull();

    up.resolve({ key: KEY, draft: draft() });
    await tick();
    await tick();
    // The ledger still gets the row, but the body lost the author's position.
    expect(done).toHaveLength(1);
    expect(nodes(ed).map((n) => n.ref)).toEqual(['file/first.pdf']);
    ed.destroy();
  });

  it('removeContentEmbeds deletes the card and the queued upload still lands where it was dropped', async () => {
    const ed = makeEditor('[embed:file:file/first.pdf]\n\ntail\n\nmore');
    await tick();
    const up = deferred<{ key: string; draft: AttachmentDraft }>();
    const { d, done } = deps(() => up.promise);
    const { id } = startFileUpload(ed.view, file(), midPos(ed), d);
    const posBefore = findPlaceholderPos(ed.state, id);
    expect(posBefore).not.toBeNull();

    expect(removeContentEmbeds(ed, 'file', ['file/first.pdf'])).toBe(1);
    expect(placeholders(ed)).toBe(1);
    // The placeholder MAPPED through the deletion instead of vanishing.
    expect(findPlaceholderPos(ed.state, id)).toBe((posBefore as number) - 1);

    up.resolve({ key: KEY, draft: draft() });
    await tick();
    await tick();
    expect(done).toHaveLength(1);
    expect(nodes(ed).map((n) => n.ref)).toEqual([KEY]);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain(`[embed:file:${KEY}]`);
    expect(out).not.toContain('file/first.pdf');
    expect(out).toContain('tail');
    ed.destroy();
  });
});
