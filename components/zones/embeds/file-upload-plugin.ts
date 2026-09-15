// In-editor file upload placeholder — the mechanism behind "drop / paste / 📎
// a file INTO the 正文 and it lands at the caret". React-free (like
// embed-node-extension.ts) so the headless vitest can drive the real plugin.
//
// Strategy: a WIDGET DECORATION, not a node (ref-tech §3.2). The document is
// UNCHANGED while a file uploads — nothing hits history, `getMarkdown()` never
// contains a half-uploaded token, the composer's autosave stores nothing, and
// a failed upload just drops the decoration. The DecorationSet is mapped
// through every transaction, so typing above the placeholder keeps it glued
// to its block. The final insert (`contentEmbed{kind:'file', ref:<key>}` at the
// mapped position, placed by the shared block rule — components/editor/flow-insert.ts)
// is ONE ordinary, undoable step.
//
// A PICK is one group (`startFileUpload(…, { batch })`, an id from
// FlowExtension's beginInsertBatch): after each card lands, the group's other
// placeholders move to right after it, and the caret follows onto the line
// below the cards while the author has not moved it. Before, every card brought
// its own empty paragraph (the waiting widgets mapped PAST it, so the next card
// found no text line to reuse — 70 px of blank between cards that the markdown
// could not even store), and the caret stayed above all of them, so typing
// "continued" above the attachments.
//
// Queue: one sequential FIFO per EditorView (WeakMap). The upload route's
// burst limiter answers 429 + `retry-after`; the queue sleeps that long with
// the placeholder in state `queued`, retries the SAME file at the SAME mapped
// position up to MAX_RATE_LIMIT_RETRIES, then fails that file only. Other
// errors fail immediately with the widget's 重试 / ✕ buttons.
//
// Progress writes `--p` on the fill node directly (zero transactions). Labels
// are handed in as strings by the editor — this module never imports next-intl.

import { Extension } from '@tiptap/core';
import { endInsertBatch, flowBatchKey, insertIntoBatch } from '@/components/editor/flow-extension';
import { placeBlockNode } from '@/components/editor/flow-insert';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { formatBytes } from '@/lib/zones/shared';
import {
  MAX_RATE_LIMIT_RETRIES,
  UploadError,
  retryWaitMs,
  type AttachmentDraft,
} from '@/components/zones/attachments/upload-core';
import { CONTENT_EMBED_NODE } from './embed-node-extension';

export const uploadKey = new PluginKey<DecorationSet>('zoneFileUpload');

export type UploadPlaceholderState = 'uploading' | 'queued' | 'failed';

export interface UploadPlaceholderMeta {
  add?: { id: string; pos: number; name: string; sizeBytes: number; batch?: string };
  remove?: { id: string };
  state?: { id: string; state: UploadPlaceholderState };
  /** Re-seat every placeholder of a pick at `pos` (in the transaction's resulting doc). */
  move?: { batch: string; pos: number };
}

/** Copy for the widget — translated by the editor, opaque here. */
export interface UploadPlaceholderLabels {
  uploading: string;
  queued: string;
  failed: string;
  cancel: string;
  retry: string;
  /** Accessible name of the whole placeholder (`正在上传 {name}`). */
  aria?: (name: string) => string;
}

export interface FileUploadPlaceholderOptions {
  labels: UploadPlaceholderLabels;
}

// Lucide `paperclip` path — inlined so the widget (plain DOM) needs no React.
const PAPERCLIP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

interface WidgetSpec {
  id: string;
  /** The pick this placeholder belongs to. */
  batch?: string;
  el: HTMLElement;
  key: string;
  side: number;
  stopEvent: () => boolean;
}

function stateLabel(labels: UploadPlaceholderLabels, state: UploadPlaceholderState): string {
  return state === 'queued' ? labels.queued : state === 'failed' ? labels.failed : labels.uploading;
}

function buildWidget(labels: UploadPlaceholderLabels, add: NonNullable<UploadPlaceholderMeta['add']>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rte-upload';
  el.dataset.id = add.id;
  el.dataset.state = 'uploading';
  el.contentEditable = 'false';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', labels.aria ? labels.aria(add.name) : add.name);

  const icon = document.createElement('span');
  icon.className = 'rte-upload-icon';
  icon.innerHTML = PAPERCLIP_SVG;

  const name = document.createElement('span');
  name.className = 'rte-upload-name';
  name.textContent = add.name;

  const size = document.createElement('span');
  size.className = 'rte-upload-size';
  size.textContent = formatBytes(add.sizeBytes);

  const bar = document.createElement('span');
  bar.className = 'rte-upload-bar';
  const fill = document.createElement('span');
  fill.className = 'rte-upload-fill';
  fill.style.setProperty('--p', '0%');
  bar.appendChild(fill);

  const state = document.createElement('span');
  state.className = 'rte-upload-state';
  state.textContent = stateLabel(labels, 'uploading');

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'rte-upload-cancel';
  cancel.setAttribute('aria-label', labels.cancel);
  cancel.title = labels.cancel;
  cancel.textContent = '✕';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'rte-upload-retry';
  retry.hidden = true;
  retry.textContent = labels.retry;

  el.append(icon, name, size, bar, state, cancel, retry);
  return el;
}

function setWidgetState(el: HTMLElement, labels: UploadPlaceholderLabels, state: UploadPlaceholderState) {
  el.dataset.state = state;
  const label = el.querySelector<HTMLElement>('.rte-upload-state');
  if (label) label.textContent = stateLabel(labels, state);
  const retry = el.querySelector<HTMLButtonElement>('.rte-upload-retry');
  if (retry) retry.hidden = state !== 'failed';
}

function findDecoration(set: DecorationSet | undefined, id: string): Decoration | null {
  if (!set) return null;
  const hits = set.find(undefined, undefined, (spec) => (spec as WidgetSpec).id === id);
  return hits[0] ?? null;
}

export const FileUploadPlaceholder = Extension.create<FileUploadPlaceholderOptions>({
  name: 'zoneFileUpload',

  addOptions() {
    return {
      labels: { uploading: '…', queued: '…', failed: '!', cancel: '✕', retry: '↻' },
    };
  },

  addProseMirrorPlugins() {
    const labels = this.options.labels;
    return [
      new Plugin<DecorationSet>({
        key: uploadKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, set: DecorationSet) {
            set = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(uploadKey) as UploadPlaceholderMeta | undefined;
            if (!meta) return set;
            if (meta.add) {
              const el = buildWidget(labels, meta.add);
              const spec: WidgetSpec = {
                id: meta.add.id,
                batch: meta.add.batch,
                el,
                key: `zone-upload-${meta.add.id}`,
                // side 1: a widget maps with assoc 1, so when an EARLIER file of
                // the same drop lands its card at this position the pending
                // widgets move AFTER it — drop order is preserved (side -1 would
                // reverse every batch).
                side: 1,
                // The widget owns its buttons: clicks inside it are never editor events.
                stopEvent: () => true,
              };
              set = set.add(tr.doc, [Decoration.widget(meta.add.pos, el, spec)]);
            }
            if (meta.state) {
              const deco = findDecoration(set, meta.state.id);
              if (deco) setWidgetState((deco.spec as WidgetSpec).el, labels, meta.state.state);
            }
            if (meta.remove) {
              const deco = findDecoration(set, meta.remove.id);
              if (deco) set = set.remove([deco]);
            }
            if (meta.move) {
              const { batch, pos } = meta.move;
              const group = set.find(undefined, undefined, (spec) => (spec as WidgetSpec).batch === batch);
              if (group.length > 0) {
                const at = Math.max(0, Math.min(pos, tr.doc.content.size));
                // Same element and key: the widget DOM is moved, not rebuilt (its progress bar keeps its width).
                set = set.remove(group).add(
                  tr.doc,
                  group.map((d) => Decoration.widget(at, (d.spec as WidgetSpec).el, d.spec as WidgetSpec)),
                );
              }
            }
            return set;
          },
        },
        props: {
          decorations: (state) => uploadKey.getState(state) ?? null,
        },
      }),
    ];
  },
});

/**
 * The top-level block boundary a file dropped / picked at `pos` lands on — the
 * same rule placeBlockNode applies to the card: an EMPTY top-level line, or the
 * START of one, gets the card ABOVE it (the line the author just made stays the
 * line after the cards); anywhere else, after the top-level block.
 */
export function blockPosFor(state: EditorState, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  const $pos = state.doc.resolve(clamped);
  if ($pos.depth === 0) return $pos.pos;
  if ($pos.depth === 1 && $pos.parent.isTextblock && !$pos.parent.type.spec.code && ($pos.parent.content.size === 0 || $pos.parentOffset === 0)) {
    return $pos.before(1);
  }
  return $pos.after(1);
}

/** Current (mapped) position of a placeholder; null once its block was deleted. */
export function findPlaceholderPos(state: EditorState, id: string): number | null {
  const deco = findDecoration(uploadKey.getState(state), id);
  return deco ? deco.from : null;
}

function placeholderEl(state: EditorState, id: string): HTMLElement | null {
  const deco = findDecoration(uploadKey.getState(state), id);
  return deco ? (deco.spec as WidgetSpec).el : null;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export interface FileUploadDeps {
  upload: (file: File, onProgress: (pct: number) => void, signal: AbortSignal) => Promise<{ key: string; draft: AttachmentDraft }>;
  /** Host appends the row to its ledger (fires even when the host block vanished — never an orphan). */
  onDone: (draft: AttachmentDraft) => void;
  /** Terminal failure of ONE file (after the 429 retries). `retry` re-runs it at the same mapped position. */
  onError: (file: File, err: unknown, retry: () => void) => void;
  /** In-flight accounting for the host's submit gate: true when a job starts / restarts, false when it settles or is cancelled. */
  onBusy?: (busy: boolean) => void;
}

interface Job {
  id: string;
  file: File;
  deps: FileUploadDeps;
  /** The pick (FlowExtension insert batch id) this file belongs to. */
  batch?: string;
  /** First terminal state reached (inserted / failed / cancelled) — releases its hold on the batch once. */
  settled: boolean;
  attempts: number;
  controller: AbortController | null;
  cancelled: boolean;
  /** Parked in `failed` — not in the FIFO, waiting for 重试 or ✕. */
  failed: boolean;
}

interface Queue {
  running: Job | null;
  pending: Job[];
}

const queues = new WeakMap<EditorView, Queue>();
/** Unsettled jobs per insert batch; the batch is ended when the last one settles. */
const batchHolds = new WeakMap<EditorView, Map<string, number>>();
let seq = 0;

function holdBatch(view: EditorView, batch: string) {
  let holds = batchHolds.get(view);
  if (!holds) {
    holds = new Map();
    batchHolds.set(view, holds);
  }
  holds.set(batch, (holds.get(batch) ?? 0) + 1);
}

/** A job reached its first terminal state: release its hold on the batch (once). */
function settle(view: EditorView, job: Job) {
  if (job.settled) return;
  job.settled = true;
  if (!job.batch) return;
  const holds = batchHolds.get(view);
  const left = (holds?.get(job.batch) ?? 1) - 1;
  if (left > 0) {
    holds?.set(job.batch, left);
    return;
  }
  holds?.delete(job.batch);
  endInsertBatch(view, job.batch);
}

function queueFor(view: EditorView): Queue {
  let q = queues.get(view);
  if (!q) {
    q = { running: null, pending: [] };
    queues.set(view, q);
  }
  return q;
}

function dispatchMeta(view: EditorView, meta: UploadPlaceholderMeta) {
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(uploadKey, meta).setMeta('addToHistory', false));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function finishInsert(view: EditorView, job: Job, key: string) {
  const pos = findPlaceholderPos(view.state, job.id);
  if (pos === null) return; // host block deleted mid-upload: the draft stays in the ledger only
  const embed = view.state.schema.nodes[CONTENT_EMBED_NODE];
  if (!embed) return;
  const node = embed.create({ kind: 'file', ref: key });
  // ONE undoable step: the placeholder goes and the card comes in at the
  // placeholder's position — a text line after it is reused or created by the
  // shared rule — and the rest of the pick's placeholders move to right AFTER
  // this card, so the next card reuses the same line instead of stacking another.
  const configure = (tr: Transaction, nodeEnd: number) =>
    tr.setMeta(uploadKey, {
      remove: { id: job.id },
      ...(job.batch ? { move: { batch: job.batch, pos: nodeEnd } } : {}),
    } satisfies UploadPlaceholderMeta);
  if (job.batch && flowBatchKey.getState(view.state)?.has(job.batch)) {
    // The flow batch decides whether the caret follows (the author has not moved it since the pick).
    insertIntoBatch(view, job.batch, node, { at: pos, topLevel: true, configure: (tr, placed) => configure(tr, placed.nodePos + node.nodeSize) });
    return;
  }
  const tr = view.state.tr;
  const placed = placeBlockNode(tr, node, pos, { topLevel: true });
  configure(tr, placed.nodePos + node.nodeSize);
  view.dispatch(tr);
}

async function runJob(view: EditorView, job: Job): Promise<void> {
  const progressEl = () => placeholderEl(view.state, job.id)?.querySelector<HTMLElement>('.rte-upload-fill') ?? null;
  for (;;) {
    if (job.cancelled || view.isDestroyed) return;
    job.attempts += 1;
    job.controller = new AbortController();
    dispatchMeta(view, { state: { id: job.id, state: 'uploading' } });
    try {
      const { key, draft } = await job.deps.upload(
        job.file,
        (pct) => progressEl()?.style.setProperty('--p', `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`),
        job.controller.signal,
      );
      if (job.cancelled) return;
      // The ledger row first (so an autosave right now already carries it), then the document.
      job.deps.onDone(draft);
      finishInsert(view, job, key);
      job.deps.onBusy?.(false);
      settle(view, job);
      return;
    } catch (err) {
      if (job.cancelled) return;
      const rateLimited = err instanceof UploadError && err.code === 'rate_limited';
      if (rateLimited && job.attempts <= MAX_RATE_LIMIT_RETRIES) {
        dispatchMeta(view, { state: { id: job.id, state: 'queued' } });
        await sleep(retryWaitMs(err));
        continue;
      }
      job.failed = true;
      dispatchMeta(view, { state: { id: job.id, state: 'failed' } });
      job.deps.onBusy?.(false);
      // A retry later lands at the placeholder without the batch (the caret no longer follows).
      settle(view, job);
      job.deps.onError(job.file, err, () => retryJob(view, job));
      return;
    }
  }
}

function pump(view: EditorView) {
  const q = queueFor(view);
  if (q.running) return;
  const next = q.pending.shift();
  if (!next) return;
  q.running = next;
  void runJob(view, next).finally(() => {
    q.running = null;
    pump(view);
  });
}

function enqueue(view: EditorView, job: Job) {
  job.failed = false;
  job.attempts = 0;
  job.deps.onBusy?.(true);
  queueFor(view).pending.push(job);
  pump(view);
}

function retryJob(view: EditorView, job: Job) {
  if (job.cancelled || !job.failed || view.isDestroyed) return;
  if (findPlaceholderPos(view.state, job.id) === null) return; // its block is gone — nothing to retry into
  enqueue(view, job);
}

function cancelJob(view: EditorView, job: Job) {
  if (job.cancelled) return;
  job.cancelled = true;
  const q = queueFor(view);
  const wasWaiting = q.pending.includes(job) || q.running === job;
  q.pending = q.pending.filter((j) => j !== job);
  job.controller?.abort();
  dispatchMeta(view, { remove: { id: job.id } });
  if (wasWaiting) job.deps.onBusy?.(false);
  settle(view, job);
}

export interface StartFileUploadOptions {
  /**
   * The pick this file belongs to: an id from FlowExtension's `beginInsertBatch`
   * (one per pick / paste / drop). Its cards stack without blank lines and the
   * caret follows them; the batch is ended once every file of it settled.
   */
  batch?: string;
}

/**
 * Adds a placeholder at the block boundary nearest `rawPos` and queues the
 * upload. Returns the placeholder id + a cancel that aborts the XHR and
 * removes the widget.
 */
export function startFileUpload(
  view: EditorView,
  file: File,
  rawPos: number,
  deps: FileUploadDeps,
  opts: StartFileUploadOptions = {},
): { id: string; cancel: () => void } {
  seq += 1;
  const id = `u${Date.now().toString(36)}-${seq}`;
  const job: Job = { id, file, deps, batch: opts.batch, settled: false, attempts: 0, controller: null, cancelled: false, failed: false };
  if (job.batch) holdBatch(view, job.batch);

  dispatchMeta(view, { add: { id, pos: blockPosFor(view.state, rawPos), name: file.name, sizeBytes: file.size, batch: opts.batch } });

  // Wire the widget's own buttons (the DOM node lives as long as the decoration).
  const el = placeholderEl(view.state, id);
  el?.querySelector<HTMLButtonElement>('.rte-upload-cancel')?.addEventListener('click', (e) => {
    e.preventDefault();
    cancelJob(view, job);
  });
  el?.querySelector<HTMLButtonElement>('.rte-upload-retry')?.addEventListener('click', (e) => {
    e.preventDefault();
    retryJob(view, job);
  });

  enqueue(view, job);
  return { id, cancel: () => cancelJob(view, job) };
}
