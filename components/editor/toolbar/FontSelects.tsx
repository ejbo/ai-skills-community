'use client';

// 字体 / 字号 / 行高 dropdowns — Word / 飞书-style selects that SHOW the current
// value. What they show comes from the toolbar's per-selection snapshot
// (EditorToolbar.tsx#readToolbarState): `activeRichValue` (null when the
// selection is mixed or unformatted) plus a `mixed` flag, so a selection over
// "12 and 24 px" text shows an EMPTY 字号 box like Word, while plain text
// shows 默认.
//
// The value sets are the storage contract (lib/rich-marks.ts): 21 font KEYS
// (never family names — the stacks are system fonts only, the intranet cannot
// load web fonts), the px 字号 list, the 行高 factors. Legacy values stored by
// v2 bodies (字号 sm / lg / xl) still display by name; the menus only offer
// the v3 values.
//
// TWO LAYOUT RULES, both of which were real bugs:
//   • Every trigger has ONE fixed width, whatever it shows. A width that
//     depended on the value moved every control to its right (and re-wrapped
//     the whole row at some container widths) as the caret crossed into a
//     formatted paragraph.
//   • The un-set triggers must not read the same. Side by side in 中文 both
//     said 「默认」; 字体 now says 默认字体 and 字号 names itself (the spoken
//     value stays 默认 through `ariaValue`).

import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { Check } from 'lucide-react';
import {
  RICH_CJK_FONT_FAMILIES,
  RICH_FONT_FAMILY_STACKS,
  RICH_FONT_SIZES,
  RICH_FONT_SIZES_PX,
  RICH_LATIN_FONT_FAMILIES,
  RICH_LINE_HEIGHTS,
  type RichFontFamily,
} from '@/lib/rich-marks';
import { lineHeightCoversContainer } from '@/components/editor/line-height';
import {
  MenuOption,
  SelectTrigger,
  ToolbarPanelShell,
  menuKeyDown,
  toolbarClasses,
  useToolbarPanel,
  useToolbarTone,
} from '@/components/editor/toolbar/primitives';

const CheckSlot = ({ on }: { on: boolean }) => (
  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
    {on && <Check className="h-3.5 w-3.5" />}
  </span>
);

interface SelectProps {
  editor: Editor;
  /** The stored value at the selection (null = mixed or none). */
  value: string | null;
  /** The selection has text with DIFFERENT values (or some without). */
  mixed?: boolean;
  disabled: boolean;
}

// ─── 字体 ────────────────────────────────────────────────────────────────────

export function FontFamilySelect({ editor, value, mixed = false, disabled }: SelectProps) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const panel = useToolbarPanel<HTMLButtonElement>({ editor, tone, width: 232, height: 420, disabled });
  const known = value != null && value in RICH_FONT_FAMILY_STACKS;
  // 默认字体 on the trigger, 默认 in the menu and to a screen reader.
  const valueText = mixed ? '' : known ? t(`rte_font_name_${value}`) : t('rte_font_trigger_default');
  const ariaValue = mixed ? '' : known ? t(`rte_font_name_${value}`) : t('rte_font_default');

  const pick = (key: RichFontFamily | null) => {
    panel.close(false);
    const chain = editor.chain().focus();
    (key == null ? chain.unsetFontFamily() : chain.setFontFamily(key)).run();
  };

  const group = (id: 'cjk' | 'latin', keys: readonly RichFontFamily[]) => (
    <div role="group" aria-label={t(`rte_font_group_${id}`)} className="mt-1">
      <div aria-hidden className={`px-2 pb-0.5 pt-1.5 text-[11px] font-medium ${cls.muted}`}>
        {t(`rte_font_group_${id}`)}
      </div>
      {keys.map((key) => (
        <MenuOption key={key} value={key} checked={!mixed && value === key} onPick={() => pick(key)} style={{ fontFamily: RICH_FONT_FAMILY_STACKS[key] }}>
          <CheckSlot on={!mixed && value === key} />
          <span className="truncate">{t(`rte_font_name_${key}`)}</span>
        </MenuOption>
      ))}
    </div>
  );

  return (
    <>
      <SelectTrigger
        ref={panel.triggerRef}
        control="font-family"
        label={t('rte_font_family')}
        valueText={valueText}
        ariaValue={ariaValue}
        open={panel.open}
        disabled={disabled}
        onClick={panel.toggleFrom}
        className="w-[6.75rem]"
      />
      <ToolbarPanelShell panel={panel} label={t('rte_font_family')} role="menu" width={232} className="p-1" onKeyDown={menuKeyDown}>
        <MenuOption value="" checked={!mixed && !known} onPick={() => pick(null)}>
          <CheckSlot on={!mixed && !known} />
          <span className="truncate">{t('rte_font_default')}</span>
        </MenuOption>
        {group('cjk', RICH_CJK_FONT_FAMILIES)}
        {group('latin', RICH_LATIN_FONT_FAMILIES)}
      </ToolbarPanelShell>
    </>
  );
}

// ─── 字号 ────────────────────────────────────────────────────────────────────

const LEGACY_SIZES: readonly string[] = RICH_FONT_SIZES;

export function FontSizeSelect({ editor, value, mixed = false, disabled }: SelectProps) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const panel = useToolbarPanel<HTMLButtonElement>({ editor, tone, width: 128, height: 420, disabled });
  const sizeName = mixed ? '' : value == null ? t('rte_size_default') : LEGACY_SIZES.includes(value) ? t(`rte_size_${value}`) : value;
  // The box names itself while nothing is set — 「默认」 twice in a row (字体 / 字号) named neither.
  const valueText = !mixed && value == null ? t('rte_size_trigger_default') : sizeName;

  const pick = (px: number | null) => {
    panel.close(false);
    const chain = editor.chain().focus();
    (px == null ? chain.unsetFontSize() : chain.setFontSize(px)).run();
  };

  return (
    <>
      <SelectTrigger
        ref={panel.triggerRef}
        control="font-size"
        label={t('rte_font_size')}
        valueText={valueText}
        ariaValue={sizeName}
        open={panel.open}
        disabled={disabled}
        onClick={panel.toggleFrom}
        className="w-[3.75rem] tabular-nums"
      />
      <ToolbarPanelShell panel={panel} label={t('rte_font_size')} role="menu" width={128} className="p-1" onKeyDown={menuKeyDown}>
        <MenuOption value="" checked={!mixed && value == null} onPick={() => pick(null)}>
          <CheckSlot on={!mixed && value == null} />
          <span className="truncate">{t('rte_size_default')}</span>
        </MenuOption>
        {RICH_FONT_SIZES_PX.map((px) => {
          const on = !mixed && value === String(px);
          return (
            <MenuOption key={px} value={String(px)} checked={on} onPick={() => pick(px)} className="tabular-nums">
              <CheckSlot on={on} />
              <span>{px}</span>
            </MenuOption>
          );
        })}
      </ToolbarPanelShell>
    </>
  );
}

// ─── 行高 ────────────────────────────────────────────────────────────────────

/** Three lines between a vertical double arrow — lucide has no line-spacing glyph. */
export function LineHeightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M11 6h10M11 12h10M11 18h10" />
      <path d="M5 4v16M2.5 6.5 5 4l2.5 2.5M2.5 17.5 5 20l2.5-2.5" />
    </svg>
  );
}

export function LineHeightSelect({ editor, value, mixed = false, disabled }: SelectProps) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const panel = useToolbarPanel<HTMLButtonElement>({ editor, tone, width: 128, height: 300, disabled });
  // 行高 is stored per TOP-LEVEL block, so a caret in one list item re-spaces
  // the whole list. Nothing on screen says so — the menu does.
  const scoped = lineHeightCoversContainer(editor.state.doc, editor.state.selection);

  const pick = (lh: string | null) => {
    panel.close(false);
    const chain = editor.chain().focus();
    (lh == null ? chain.unsetLineHeight() : chain.setLineHeight(lh)).run();
  };

  return (
    <>
      <SelectTrigger
        ref={panel.triggerRef}
        control="line-height"
        label={t('rte_line_height')}
        valueText={mixed ? '' : (value ?? '')}
        open={panel.open}
        disabled={disabled}
        onClick={panel.toggleFrom}
        icon={<LineHeightIcon className="h-4 w-4 shrink-0" />}
        // ONE width, always: 4.75rem is what「1.75」measures beside the icon and
        // the chevron (a 28 px label slot). A value-dependent width shifted
        // every control to its right — and re-wrapped the row in narrow
        // containers — on every caret move.
        className="w-[4.75rem] tabular-nums"
      />
      <ToolbarPanelShell panel={panel} label={t('rte_line_height')} role="menu" width={128} className="p-1" onKeyDown={menuKeyDown}>
        {scoped && (
          <div className={`px-2 pb-1 pt-1.5 text-[11px] leading-4 ${cls.muted}`}>{t('rte_line_height_scope')}</div>
        )}
        <MenuOption value="" checked={!mixed && value == null} onPick={() => pick(null)}>
          <CheckSlot on={!mixed && value == null} />
          <span className="truncate">{t('rte_line_height_default')}</span>
        </MenuOption>
        {RICH_LINE_HEIGHTS.map((lh) => (
          <MenuOption key={lh} value={lh} checked={value === lh} onPick={() => pick(lh)} className="tabular-nums">
            <CheckSlot on={value === lh} />
            <span>{lh}</span>
          </MenuOption>
        ))}
      </ToolbarPanelShell>
    </>
  );
}
