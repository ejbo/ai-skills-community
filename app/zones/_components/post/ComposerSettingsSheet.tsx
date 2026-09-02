'use client';

// Everything about a post that is NOT its text: 封面 · 链接 · 标签 · 合著者 ·
// 可见范围 (+ 指定成员 / 访问密码) · a stats line · 重置. On `xl` it is the
// composer's sticky right column; below `xl` the same content lives in a
// right-side DrawerShell opened by the top bar's ⚙ (phones get the drawer too —
// no bottom variant this round), with 保存草稿 in its footer because the top bar
// hides that button on small screens.
//
// The content renders in ONE place at a time: the column while the viewport is
// (or may be) xl, the drawer only while it is open below xl — so the pickers
// never mount twice. `xl` is null until measured; SSR paints the column.

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';
import { useRef } from 'react';
import { DrawerShell } from '@/components/motion';
import { StatefulButton } from '@/components/motion/StatefulButton';
import { withBasePath } from '@/lib/base-path';
import { ZONE_IMAGE_TYPES, type ZonePostVisibilityValue } from '@/lib/zones/shared';
import { INPUT_CLS } from '@/app/zones/_components/ui';
import { TagInput } from './TagInput';
import { CoauthorPicker, type CoauthorPick } from './CoauthorPicker';
import { VisibilityPicker } from './VisibilityPicker';
import { PostAccessPanel, type DesignatedPick } from './PostAccessPanel';

const XL_QUERY = '(min-width: 1280px)';

export interface ComposerSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  disabled: boolean;
  zoneSlug: string;
  selfHandle: string;
  selfUserId: string;
  cover: { key: string; url: string } | null;
  coverBusy: boolean;
  onPickCover: (file: File) => void;
  onRemoveCover: () => void;
  linkUrl: string;
  onLinkChange: (v: string) => void;
  tags: string[];
  onTagsChange: (v: string[]) => void;
  coauthors: CoauthorPick[];
  onCoauthorsChange: (v: CoauthorPick[]) => void;
  visibility: ZonePostVisibilityValue;
  onVisibilityChange: (v: ZonePostVisibilityValue) => void;
  access: {
    postId: string | null;
    serverRestricted: boolean;
    designated: DesignatedPick[];
    onDesignatedChange: (v: DesignatedPick[]) => void;
    accessCode: string | null;
    onAccessCodeChange: (v: string | null) => void;
    regenerate: boolean;
    onRegenerateChange: (v: boolean) => void;
  };
  charCount: number;
  readMinutes: number;
  onReset: () => void;
  saveLabel: string;
  onSaveDraft: () => Promise<boolean>;
  /** In-flight uploads block 保存草稿 (mirrors the top bar). */
  uploading: number;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      {children}
    </section>
  );
}

function SheetBody(p: ComposerSettingsSheetProps) {
  const t = useTranslations('zones');
  const coverInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-6">
      <Section label={t('composer_cover_label')}>
        {p.cover ? (
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath(p.cover.url)} alt="" className="aspect-[2/1] w-full object-cover" />
            <button
              type="button"
              onClick={p.onRemoveCover}
              disabled={p.disabled}
              aria-label={t('composer_cover_remove')}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            disabled={p.disabled || p.coverBusy}
            className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-xs text-muted transition hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            {p.coverBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {t('composer_cover_add')}
          </button>
        )}
        <input
          ref={coverInput}
          type="file"
          accept={Array.from(ZONE_IMAGE_TYPES).join(',')}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onPickCover(f);
            e.target.value = '';
          }}
        />
      </Section>

      <Section label={t('composer_link_label')}>
        <input
          value={p.linkUrl}
          onChange={(e) => p.onLinkChange(e.target.value)}
          placeholder="https://"
          inputMode="url"
          disabled={p.disabled}
          aria-label={t('composer_link_label')}
          className={`${INPUT_CLS} font-mono`}
        />
        <p className="mt-1.5 text-[11px] text-muted">{t('composer_link_optional_hint')}</p>
      </Section>

      <Section label={t('composer_tags_label')}>
        <TagInput value={p.tags} onChange={p.onTagsChange} disabled={p.disabled} />
      </Section>

      <Section label={t('composer_coauthors_label')}>
        <CoauthorPicker zoneSlug={p.zoneSlug} value={p.coauthors} onChange={p.onCoauthorsChange} selfHandle={p.selfHandle} disabled={p.disabled} />
      </Section>

      <Section label={t('composer_visibility_label')}>
        <div className="space-y-3">
          <VisibilityPicker value={p.visibility} onChange={p.onVisibilityChange} disabled={p.disabled} />
          {p.visibility === 'restricted' && (
            <PostAccessPanel
              zoneSlug={p.zoneSlug}
              postId={p.access.postId}
              serverRestricted={p.access.serverRestricted}
              designated={p.access.designated}
              onDesignatedChange={p.access.onDesignatedChange}
              accessCode={p.access.accessCode}
              onAccessCodeChange={p.access.onAccessCodeChange}
              regenerate={p.access.regenerate}
              onRegenerateChange={p.access.onRegenerateChange}
              selfUserId={p.selfUserId}
              disabled={p.disabled}
            />
          )}
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 text-[11px] text-muted dark:border-zinc-800">
        <span className="font-mono tabular-nums">
          {t('composer_chars', { count: p.charCount })} · {t('composer_read_minutes', { count: p.readMinutes })}
        </span>
        <button
          type="button"
          onClick={p.onReset}
          disabled={p.disabled}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('composer_reset')}
        </button>
      </div>
    </div>
  );
}

export function ComposerSettingsSheet(p: ComposerSettingsSheetProps) {
  const t = useTranslations('zones');
  const [xl, setXl] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(XL_QUERY);
    const sync = () => setXl(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Growing past xl while the drawer is open: the column takes over.
  const { open, onClose } = p;
  useEffect(() => {
    if (xl && open) onClose();
  }, [xl, open, onClose]);

  return (
    <>
      <aside className="hidden xl:block">
        <div className="sticky top-16 space-y-6">{xl !== false && <SheetBody {...p} />}</div>
      </aside>
      <DrawerShell
        open={open && xl === false}
        onClose={onClose}
        title={t('composer_settings')}
        width={380}
        bodyClassName="p-4"
        footer={
          <div className="flex justify-end">
            <StatefulButton
              onAction={p.onSaveDraft}
              disabled={p.disabled || p.uploading > 0}
              className="h-9 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500"
            >
              {p.saveLabel}
            </StatefulButton>
          </div>
        }
      >
        {open && xl === false && <SheetBody {...p} />}
      </DrawerShell>
    </>
  );
}
