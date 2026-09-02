'use client';

// React nodeview for the in-editor 技术专区 embed (embed-node-extension.ts): the
// same EmbedCard the reader sees, rendered static (clicking the card never
// navigates inside the editor) with 预览 (file cards → the docked reading
// panel, through the extension's `onPreview`) and 移除. `.ce-card` carries the
// selected outline.
//
// LOCAL-FIRST: a `file` ref is looked up in `extension.options.getLocal()`
// (saved attachments by id + key, unsaved drafts by key) and rendered from
// memory — an upload that finished a second ago has no row yet, and the API
// would answer `not_found` until the draft is saved. Only refs the composer
// does not know about fall back to the card's own fetch.

import { useMemo, type MouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Eye, Trash2 } from 'lucide-react';
import { TWEEN_FAST } from '@/lib/motion';
import { isEmbedKind, type EmbedKind } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { EmbedCard } from './EmbedCard';
import type { ContentEmbedOptions } from './embed-node-extension';

type LocalFileEmbed = Extract<EmbedData, { kind: 'file'; ok: true }>;

const BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

export function EmbedNodeView({ node, deleteNode, extension }: NodeViewProps) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const rawKind = String(node.attrs.kind ?? '');
  const kind: EmbedKind = isEmbedKind(rawKind) ? rawKind : 'link';
  const ref = String(node.attrs.ref ?? '');
  const options = extension.options as ContentEmbedOptions;

  // Synthesised EmbedData for a locally known attachment (id or key form).
  const local = useMemo<LocalFileEmbed | undefined>(() => {
    if (kind !== 'file' || !options.getLocal) return undefined;
    const { map, zoneSlug } = options.getLocal();
    const hit = map.get(ref);
    return hit ? { kind: 'file', ref, ok: true, data: { ...hit, postId: '', zoneSlug } } : undefined;
    // getLocal reads a ref the editor rebuilds every render; the lookup key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ref, options.getLocal]);

  const canPreview = kind === 'file' && Boolean(options.onPreview);
  const openPreview = (e: MouseEvent<HTMLButtonElement>) => {
    options.onPreview?.({
      kind: 'file',
      ref,
      title: local?.data.name,
      data: local,
      // A keyboard "click" (Enter / Space) reports detail 0 — the panel then takes focus.
      via: e.detail === 0 ? 'keyboard' : 'pointer',
    });
  };

  return (
    <NodeViewWrapper
      className="ce-card my-2 flex items-start gap-1 rounded-xl"
      data-content-embed=""
      data-embed-kind={kind}
      data-embed-ref={ref}
      contentEditable={false}
    >
      {/* Client-only mount (the editor never server-renders), so `initial` is allowed: the
          placeholder → card swap reads as one motion instead of a pop. */}
      <motion.div
        className="min-w-0 flex-1"
        initial={reduce ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : TWEEN_FAST}
      >
        <EmbedCard kind={kind} embedRef={ref} data={local} static compact className="!my-0" />
      </motion.div>
      <div className="mt-1 flex shrink-0 flex-col gap-0.5">
        {canPreview && (
          <button type="button" title={t('composer_preview_file')} aria-label={t('composer_preview_file')} onClick={openPreview} className={BTN}>
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" title={t('embed_remove')} aria-label={t('embed_remove')} onClick={() => deleteNode()} className={BTN}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}
