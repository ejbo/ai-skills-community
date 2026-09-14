'use client';

// 版块设置 → 主页布局: the right rail as a list the 版主 can edit — a visibility
// switch per built-in module (关于 is locked on — a board always says who runs
// it), ↑/↓ to reorder, and custom cards (title + markdown) slotted anywhere in
// the same list. Saves the whole `ZoneSidebarLayout` in ONE PATCH; the server
// re-runs `parseSidebarLayout`, so the client sends exactly what it shows.
//
// The order list is the single source: custom cards live IN `order`, so
// moving one past a built-in is the same ↑/↓ as any other row. Card ids are
// `custom:` + 8 random [a-z0-9] — unique per zone, generated here.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Lock, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import {
  CUSTOM_MODULE_PREFIX,
  MAX_SIDEBAR_CUSTOM_CARDS,
  SIDEBAR_CARD_BODY_MAX,
  SIDEBAR_CARD_TITLE_MAX,
  SIDEBAR_REQUIRED_MODULES,
  defaultSidebarLayout,
  isBuiltinModule,
  isDefaultSidebarLayout,
  parseSidebarLayout,
  type SidebarBuiltinModule,
  type ZoneSidebarLayout,
} from '@/lib/zones/sidebar';
import { BTN_ICON, BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, PILL_MONO, readError } from './ui';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newCardId(): string {
  let s = CUSTOM_MODULE_PREFIX;
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
}

function move(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function SidebarLayoutEditor({ zoneSlug, initial }: { zoneSlug: string; initial: ZoneSidebarLayout }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [layout, setLayout] = useState<ZoneSidebarLayout>(() => parseSidebarLayout(initial));
  const [busy, setBusy] = useState(false);
  const cards = useMemo(() => new Map(layout.custom.map((c) => [c.id, c])), [layout.custom]);
  const isDefault = isDefaultSidebarLayout(layout);
  const required = new Set<string>(SIDEBAR_REQUIRED_MODULES);

  function toggle(id: SidebarBuiltinModule) {
    if (required.has(id)) return;
    setLayout((l) => ({
      ...l,
      hidden: l.hidden.includes(id) ? l.hidden.filter((h) => h !== id) : [...l.hidden, id],
    }));
  }

  function addCard() {
    if (layout.custom.length >= MAX_SIDEBAR_CUSTOM_CARDS) {
      pushToast('error', t('layout_limit', { max: MAX_SIDEBAR_CUSTOM_CARDS }));
      return;
    }
    const id = newCardId();
    setLayout((l) => ({ ...l, order: [...l.order, id], custom: [...l.custom, { id, title: '', bodyMd: '' }] }));
  }

  function updateCard(id: string, patch: { title?: string; bodyMd?: string }) {
    setLayout((l) => ({ ...l, custom: l.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }

  function removeCard(id: string) {
    setLayout((l) => ({ ...l, order: l.order.filter((o) => o !== id), custom: l.custom.filter((c) => c.id !== id) }));
  }

  async function save() {
    if (busy) return;
    // An empty custom card would be dropped by the server's parser and silently
    // vanish — refuse it here so the 版主 sees why.
    if (layout.custom.some((c) => !c.title.trim() && !c.bodyMd.trim())) {
      pushToast('error', t('layout_card_empty'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sidebar: layout }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('layout_saved'));
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${CARD_CLS} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('layout_title')}</h2>
            <p className={HINT_CLS}>{t('layout_hint')}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isDefault && (
              <button type="button" onClick={() => setLayout(defaultSidebarLayout())} disabled={busy} className={BTN_SECONDARY}>
                <RotateCcw className="h-4 w-4" />
                {t('layout_reset')}
              </button>
            )}
            <button
              type="button"
              onClick={addCard}
              disabled={busy || layout.custom.length >= MAX_SIDEBAR_CUSTOM_CARDS}
              className={BTN_SECONDARY}
            >
              <Plus className="h-4 w-4" />
              {t('layout_add_card')}
              <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                {layout.custom.length}/{MAX_SIDEBAR_CUSTOM_CARDS}
              </span>
            </button>
          </div>
        </div>

        <ol className="mt-4 space-y-2">
          {layout.order.map((id, i) => {
            const builtin = isBuiltinModule(id);
            const card = builtin ? null : cards.get(id);
            if (!builtin && !card) return null;
            const hidden = builtin && layout.hidden.includes(id);
            const locked = builtin && required.has(id);
            return (
              <li
                key={id}
                className={`rounded-xl border p-3 transition ${
                  hidden
                    ? 'border-dashed border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40'
                    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm font-medium ${hidden ? 'text-zinc-400 line-through' : ''}`}>
                    {builtin ? t(`layout_module_${id as SidebarBuiltinModule}`) : card!.title || t('layout_custom_untitled')}
                  </span>
                  <span className={`${PILL_MONO} normal-case tracking-normal`}>
                    {builtin ? t('layout_kind_builtin') : t('layout_kind_custom')}
                  </span>
                  {builtin ? (
                    <button
                      type="button"
                      onClick={() => toggle(id as SidebarBuiltinModule)}
                      disabled={busy || locked}
                      aria-pressed={!hidden}
                      aria-label={locked ? t('layout_locked') : hidden ? t('layout_show') : t('layout_hide')}
                      title={locked ? t('layout_locked') : hidden ? t('layout_show') : t('layout_hide')}
                      className={BTN_ICON}
                    >
                      {locked ? <Lock className="h-4 w-4" /> : hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeCard(id)}
                      disabled={busy}
                      aria-label={t('layout_remove_card')}
                      title={t('layout_remove_card')}
                      className={BTN_ICON}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setLayout((l) => ({ ...l, order: move(l.order, i, i - 1) }))}
                    disabled={busy || i === 0}
                    aria-label={t('layout_move_up')}
                    title={t('layout_move_up')}
                    className={BTN_ICON}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout((l) => ({ ...l, order: move(l.order, i, i + 1) }))}
                    disabled={busy || i === layout.order.length - 1}
                    aria-label={t('layout_move_down')}
                    title={t('layout_move_down')}
                    className={BTN_ICON}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>

                {card && (
                  <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <div>
                      <label className={LABEL_CLS} htmlFor={`${id}-title`}>
                        {t('layout_card_title')}
                      </label>
                      <input
                        id={`${id}-title`}
                        value={card.title}
                        maxLength={SIDEBAR_CARD_TITLE_MAX}
                        onChange={(e) => updateCard(id, { title: e.target.value })}
                        placeholder={t('layout_card_title_placeholder')}
                        className={INPUT_CLS}
                        disabled={busy}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>{t('layout_card_body')}</label>
                      <RichTextEditor
                        value={card.bodyMd}
                        onChange={(md) => updateCard(id, { bodyMd: md })}
                        placeholder={t('layout_card_body_hint')}
                        variant="full"
                        size="compact"
                        maxLength={SIDEBAR_CARD_BODY_MAX}
                        maxHeight={260}
                        disabled={busy}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={busy} className={BTN_PRIMARY}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('save')}
        </button>
      </div>
    </div>
  );
}
