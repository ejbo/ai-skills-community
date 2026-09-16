'use client';

// The table strip, shown while the caret is in a table.
//
// It is an OVERLAY (`absolute` under the toolbar box), not a second row: as an
// in-flow row it had to stay MOUNTED for the whole document — mounting it on
// caret entry inserted a 33 px band above the text on mousedown in a cell (59 px
// on a phone, where it wrapped), so the cell under the pointer jumped away and a
// quick second tap hit the wrong row. Reserving that height instead left every
// document that merely CONTAINS a table with a dead band under the sticky
// toolbar (doubling the sticky chrome on a phone). Overlaying reserves nothing
// and still never moves the text.
//
// The one thing the overlay owes the old design is the mis-tap guard: for the
// first moments after it appears the strip takes no pointer events, so the
// second tap of a quick double-tap in a cell it happens to cover cannot land on
// 删除行. Below `sm` it is ONE sideways-scrolling row like the main toolbar row.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { ArrowDownToLine, ArrowUpToLine, Columns3, Minus, Rows3, Trash2 } from 'lucide-react';
import { insertParagraphBesideTable } from '@/components/markdown-table';
import { ToolbarDivider } from '@/components/editor/toolbar/primitives';

/** How long the freshly shown strip ignores pointer events (the mis-tap guard). */
export const TABLE_STRIP_ARM_MS = 300;

export function TableToolbar({ editor, canDeleteRow, canDeleteColumn }: { editor: Editor; canDeleteRow: boolean; canDeleteColumn: boolean }) {
  const t = useTranslations('ui');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), TABLE_STRIP_ARM_MS);
    return () => clearTimeout(id);
  }, []);
  const icon = 'h-3.5 w-3.5';
  const btn =
    'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';
  return (
    <div
      className={`rte-toolbar-row rte-table-strip absolute inset-x-0 top-full z-10 flex items-center gap-0.5 overflow-x-auto border-b border-t border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-1.5 py-1 shadow-sm sm:flex-wrap sm:overflow-x-visible [&>*]:shrink-0 ${
        armed ? '' : 'pointer-events-none'
      }`}
      role="toolbar"
      aria-label={t('rte_table_toolbar')}
    >
      {/* A table that starts or ends the document used to leave nowhere to type
          above / below it (markdown stores no empty line). These two put a text
          line right there — reusing an empty one — and the caret on it. */}
      <button
        type="button"
        className={btn}
        title={t('rte_table_para_above_hint')}
        aria-label={t('rte_table_para_above_hint')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertParagraphBesideTable(editor, 'before')}
      >
        <ArrowUpToLine className={icon} />
        {t('rte_table_para_above')}
      </button>
      <button
        type="button"
        className={btn}
        title={t('rte_table_para_below_hint')}
        aria-label={t('rte_table_para_below_hint')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertParagraphBesideTable(editor, 'after')}
      >
        <ArrowDownToLine className={icon} />
        {t('rte_table_para_below')}
      </button>
      <ToolbarDivider />
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Rows3 className={icon} />
        {t('rte_table_add_row')}
      </button>
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Columns3 className={icon} />
        {t('rte_table_add_col')}
      </button>
      <ToolbarDivider />
      <button type="button" className={btn} disabled={!canDeleteRow} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>
        <Minus className={icon} />
        {t('rte_table_del_row')}
      </button>
      <button type="button" className={btn} disabled={!canDeleteColumn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Minus className={icon} />
        {t('rte_table_del_col')}
      </button>
      <ToolbarDivider />
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 className={icon} />
        {t('rte_table_delete')}
      </button>
    </div>
  );
}
