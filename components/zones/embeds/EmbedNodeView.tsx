'use client';

// React nodeview for the in-editor 技术专区 embed (embed-node-extension.ts): the
// same EmbedCard the reader sees, rendered static (no preview drawer inside
// the editor) with a 移除 affordance. `.ce-card` carries the selected outline.

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { isEmbedKind, type EmbedKind } from '@/lib/zones/shared';
import { EmbedCard } from './EmbedCard';

export function EmbedNodeView({ node, deleteNode }: NodeViewProps) {
  const t = useTranslations('zones');
  const rawKind = String(node.attrs.kind ?? '');
  const kind: EmbedKind = isEmbedKind(rawKind) ? rawKind : 'link';
  const ref = String(node.attrs.ref ?? '');

  return (
    <NodeViewWrapper
      className="ce-card my-2 flex items-start gap-1 rounded-xl"
      data-content-embed=""
      data-embed-kind={kind}
      data-embed-ref={ref}
      contentEditable={false}
    >
      <div className="min-w-0 flex-1">
        <EmbedCard kind={kind} embedRef={ref} static compact className="!my-0" />
      </div>
      <button
        type="button"
        title={t('embed_remove')}
        aria-label={t('embed_remove')}
        onClick={() => deleteNode()}
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </NodeViewWrapper>
  );
}
