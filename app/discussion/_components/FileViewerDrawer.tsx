'use client';

// 讨论区 attachment viewer: the shared components/files/FileViewer inside the
// modal DrawerShell. The drawer supplies everything a modal owes the page —
// portaled to <body> (feed cards wear transforms that would trap a fixed box),
// scrim, ESC to close, body scroll lock, focus moved in and RETURNED to the card
// that opened it. The viewer picks the renderer from the STORAGE KEY's extension
// (code / json / csv / markdown / pdf / image / audio / video), and everything it
// cannot preview — archives, executables, Office (讨论区 has no LibreOffice
// rendition; that pipeline is 技术专区's) — lands on its single 不支持预览 card
// with its own 下载. So the header's 下载 is shown only when the preview
// itself does not already carry one.
//
// 讨论区 is publicly readable but its media route needs a session (unchanged):
// for an anonymous reader a text preview fails into the viewer's load-failed
// card, and inline media answers 401 — exactly what the old new-tab link did.

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { DrawerShell } from '@/components/motion/DrawerShell';
import { FileViewer, fileMetaLabel } from '@/components/files/FileViewer';
import { fileDownloadHref } from '@/lib/files/display';
import { isDownloadOnlyFile, type DiscussionFileTarget } from './file-attachments';

export function FileViewerDrawer({ file, onClose }: { file: DiscussionFileTarget | null; onClose: () => void }) {
  const t = useTranslations('zones');
  // The drawer animates OUT after `file` goes null; keep rendering the last file meanwhile.
  const lastRef = useRef<DiscussionFileTarget | null>(file);
  if (file) lastRef.current = file;
  const shown = file ?? lastRef.current;

  const downloadOnly = shown ? isDownloadOnlyFile(shown.storageKey, shown.name) : false;

  return (
    <DrawerShell
      open={Boolean(file)}
      onClose={onClose}
      width={880}
      title={shown?.name ?? ''}
      bodyClassName="p-4"
      headerExtra={
        shown ? (
          <>
            <span className="hidden font-mono text-[11px] tabular-nums text-muted sm:inline">
              {fileMetaLabel(shown.name, shown.storageKey, shown.sizeBytes, t('attach_type_generic'))}
            </span>
            {!downloadOnly && (
              <a
                href={fileDownloadHref(shown.url, shown.name)}
                download
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {t('attach_download')}
              </a>
            )}
          </>
        ) : null
      }
    >
      {shown && (
        <FileViewer
          // A different attachment starts from a clean fetch / toggle state.
          key={shown.url}
          url={shown.url}
          name={shown.name}
          storageKey={shown.storageKey}
          sizeBytes={shown.sizeBytes}
          layout="box"
        />
      )}
    </DrawerShell>
  );
}
