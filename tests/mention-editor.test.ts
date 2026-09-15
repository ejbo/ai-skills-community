// @vitest-environment jsdom
//
// The @人 editor mechanism, headless. Three things are worth a test and none of
// them can be seen from a unit test of lib/mentions.ts alone:
//
// 1. THE ROUND TRIP. A pick must serialize to EXACTLY the stored contract
//    (`[@显示名](/users/<handle>)`), and re-opening that markdown in a fresh
//    editor must leave it byte-identical — that is the entire justification for
//    storing a mention as a plain link instead of a custom node.
// 2. THE TRIGGER. `@` must fire mid-中文 (no spaces are typed there) but NOT
//    inside an email address, and never inside code.
// 3. NO INTERFERENCE. The editor already registers a sticker inline node, the
//    poll atom and tables; tests/editor-embed-smoke.test.ts guards those, this
//    file re-runs the mention through the same stack to prove the link mark and
//    the suggestion plugin do not disturb them.
//
// Like the smoke test, the extension list is the REAL one:
// buildRichTextExtensions (components/editor/rich-text-extensions.ts) is what
// components/RichTextEditor.tsx registers, minus the React node views. Its
// ORDER is part of what is tested: TABLE_EXTENSIONS before MentionSuggestion is
// what lets the popup see Enter / arrows before a table cell does (last
// describe block).
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import {
  MentionSuggestion,
  MentionSuggestionPluginKey,
  insertMention,
  mentionLabelOf,
  mentionTriggerAllowed,
} from '@/components/mention/mention-suggestion';
import { extractMentionHandles, mentionMarkdown } from '@/lib/mentions';

const STICKER_URL_PREFIX = '/api/uploads/stickers/';

function makeEditor(content = '', mention: Parameters<typeof MentionSuggestion.configure>[0] = {}) {
  // Link autolink ON (RICH_TEXT_LINK_OPTIONS) is what makes the Link mark
  // `inclusive` and therefore what the trailing space guards.
  return new Editor({ extensions: buildRichTextExtensions({ mention }), content });
}

/** The range the suggestion plugin would hand `command` for the trailing `@…`. */
function suggestionRange(ed: Editor) {
  const state = MentionSuggestionPluginKey.getState(ed.state);
  return state?.active ? (state.range as { from: number; to: number }) : null;
}

const WANG = { handle: 'z84412632', displayName: '王伟' };

describe('mention trigger', () => {
  it('mentionTriggerAllowed: line start, spaces and CJK fire; email characters do not', () => {
    for (const prev of ['', ' ', ' ', '你', '。', '(', '【', ':', '\n', '，']) {
      expect([prev, mentionTriggerAllowed(prev)]).toEqual([prev, true]);
    }
    for (const prev of ['a', 'Z', '7', '_', '.', '-', '+']) {
      expect([prev, mentionTriggerAllowed(prev)]).toEqual([prev, false]);
    }
  });

  it('typing `@wan` activates the suggestion and exposes the query', () => {
    const ed = makeEditor('hi');
    ed.commands.focus('end');
    // Typed, not seeded: markdown parsing trims a trailing space, and the space
    // before the `@` is exactly what the prefix rule looks at.
    ed.commands.insertContent(' @wan');
    const state = MentionSuggestionPluginKey.getState(ed.state);
    expect(state?.active).toBe(true);
    expect(state?.query).toBe('wan');
    ed.destroy();
  });

  it('fires directly after 中文 with no space (the default prefix rule would not)', () => {
    const ed = makeEditor('你好');
    ed.commands.focus('end');
    ed.commands.insertContent('@张');
    expect(MentionSuggestionPluginKey.getState(ed.state)?.active).toBe(true);
    ed.destroy();
  });

  it('does NOT fire inside an email address', () => {
    const ed = makeEditor('mail bob');
    ed.commands.focus('end');
    ed.commands.insertContent('@exa');
    expect(MentionSuggestionPluginKey.getState(ed.state)?.active).toBe(false);
    ed.destroy();
  });

  it('does NOT fire inside a code block', () => {
    const ed = makeEditor('');
    ed.commands.focus('end');
    ed.commands.setCodeBlock();
    ed.commands.insertContent('@wan');
    expect(MentionSuggestionPluginKey.getState(ed.state)?.active).toBe(false);
    ed.destroy();
  });
});

describe('mention insertion + markdown round trip', () => {
  it('a pick serializes to the stored contract and survives a re-open unchanged', () => {
    const ed = makeEditor('hi');
    ed.commands.focus('end');
    ed.commands.insertContent(' @wan');
    const range = suggestionRange(ed);
    expect(range).not.toBeNull();

    insertMention(ed, range!, WANG);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain(mentionMarkdown(WANG.displayName, WANG.handle));
    expect(extractMentionHandles(out)).toEqual([WANG.handle]);
    ed.destroy();

    // Re-open what was stored: the mention comes back untouched (the property a
    // custom node would have had to earn). The only difference is the trailing
    // space the pick leaves in the doc, which markdown does not keep at all.
    const again = makeEditor(out);
    const second: string = again.storage.markdown.getMarkdown();
    expect(second).toBe(out.trimEnd());
    expect(extractMentionHandles(second)).toEqual([WANG.handle]);
    again.destroy();

    // …and it is a fixed point from there: editing a post over and over never
    // rewrites somebody else's mention.
    const third = makeEditor(second);
    expect(third.storage.markdown.getMarkdown()).toBe(second);
    third.destroy();
  });

  it('the mention is a link mark on plain text — no custom node in the doc', () => {
    const ed = makeEditor('');
    ed.commands.focus('end');
    ed.commands.insertContent('@w');
    insertMention(ed, suggestionRange(ed)!, WANG);
    const types = new Set<string>();
    let href: string | null = null;
    ed.state.doc.descendants((n) => {
      types.add(n.type.name);
      const mark = n.marks.find((m) => m.type.name === 'link');
      if (mark) href = String(mark.attrs.href);
      return true;
    });
    expect(types).toEqual(new Set(['paragraph', 'text']));
    expect(href).toBe(`/users/${WANG.handle}`);
    ed.destroy();
  });

  it('typing after a mention does not grow the link (the trailing space is load-bearing)', () => {
    const ed = makeEditor('');
    ed.commands.focus('end');
    ed.commands.insertContent('@w');
    insertMention(ed, suggestionRange(ed)!, WANG);
    ed.commands.insertContent('看一下');
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toBe(`${mentionMarkdown(WANG.displayName, WANG.handle)} 看一下`);
    expect(extractMentionHandles(out)).toEqual([WANG.handle]);
    ed.destroy();
  });

  it('a display name with markdown syntax still yields an extractable handle', () => {
    const person = { handle: 'alice', displayName: 'A*B_C [x]' };
    const ed = makeEditor('');
    ed.commands.focus('end');
    ed.commands.insertContent('@a');
    insertMention(ed, suggestionRange(ed)!, person);
    const out = ed.storage.markdown.getMarkdown();
    // The label rule (lib/mentions.ts) replaces the bracket; the serializer may
    // escape the rest. What must hold is that the HREF still parses.
    expect(extractMentionHandles(out)).toEqual(['alice']);
    expect(mentionLabelOf(person.displayName, person.handle)).toBe('A*B_C  x ');
    ed.destroy();
  });

  it('two mentions in one body both extract, in order', () => {
    const ed = makeEditor('');
    ed.commands.focus('end');
    ed.commands.insertContent('@w');
    insertMention(ed, suggestionRange(ed)!, WANG);
    ed.commands.insertContent('@a');
    insertMention(ed, suggestionRange(ed)!, { handle: 'alice', displayName: 'Alice' });
    expect(extractMentionHandles(ed.storage.markdown.getMarkdown())).toEqual([WANG.handle, 'alice']);
    ed.destroy();
  });
});

describe('coexistence with the other editor mechanisms', () => {
  it('mention, sticker and poll survive one another in the same document', async () => {
    const pollId = 'clxyz12345abcde';
    const ed = makeEditor(`start ![sticker](${STICKER_URL_PREFIX}abc123.gif)\n\n[poll:${pollId}]\n\ntail`);
    await new Promise((r) => setTimeout(r, 0)); // the poll normalizer runs in a microtask

    ed.commands.focus('end');
    ed.commands.insertContent(' @w');
    insertMention(ed, suggestionRange(ed)!, WANG);

    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain(`![sticker](${STICKER_URL_PREFIX}abc123.gif)`);
    expect(out).toMatch(/^ {0,3}\\?\[poll:clxyz12345abcde\\?\][ \t]*$/m);
    expect(extractMentionHandles(out)).toEqual([WANG.handle]);

    const types: string[] = [];
    ed.state.doc.descendants((n) => {
      types.push(n.type.name);
      return true;
    });
    expect(types).toContain('stickerImage');
    expect(types).toContain('pollEmbed');
    ed.destroy();
  });

  it('a mention inside a fenced block renders but never notifies (lib/mentions.ts)', () => {
    const md = ['```md', mentionMarkdown('王伟', 'z84412632'), '```'].join('\n');
    const ed = makeEditor(md);
    expect(extractMentionHandles(ed.storage.markdown.getMarkdown())).toEqual([]);
    ed.destroy();
  });
});

describe('the @人 popup and table cells share Enter', () => {
  const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const cellEnd = (ed: Editor) => {
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'tableCell') at = pos + n.nodeSize - 2;
      return true;
    });
    return at;
  };
  const pressEnter = (ed: Editor) => ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const hardBreaks = (ed: Editor) => {
    let n = 0;
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'hardBreak') n += 1;
      return true;
    });
    return n;
  };

  it('with the popup open, Enter goes to the popup (it picks) — not a cell line break', () => {
    const ed = makeEditor(TABLE_MD, { onKeyDown: (event) => event.key === 'Enter' });
    ed.commands.setTextSelection(cellEnd(ed));
    ed.commands.insertContent(' @wa');
    expect(MentionSuggestionPluginKey.getState(ed.state)?.active).toBe(true);
    pressEnter(ed);
    expect(hardBreaks(ed)).toBe(0);
    expect(ed.storage.markdown.getMarkdown()).not.toContain('<table');
    ed.destroy();
  });

  it('when the popup declines the key, Enter in the cell is a GFM-safe line break', () => {
    const ed = makeEditor(TABLE_MD, { onKeyDown: () => false });
    ed.commands.setTextSelection(cellEnd(ed));
    ed.commands.insertContent(' @wa');
    pressEnter(ed);
    expect(hardBreaks(ed)).toBe(1);
    ed.commands.insertContent('next');
    const out: string = ed.storage.markdown.getMarkdown();
    expect(out).toContain('<br>');
    expect(out).not.toContain('<table');
    ed.destroy();
  });

  it('a bold mention next to CJK text keeps notifying after a save + reopen', () => {
    const ed = makeEditor('');
    ed.commands.setContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '请' },
              { type: 'text', text: '联系', marks: [{ type: 'bold' }] },
              { type: 'text', text: '@王伟', marks: [{ type: 'link', attrs: { href: `/users/${WANG.handle}` } }, { type: 'bold' }] },
              { type: 'text', text: '看一下' },
            ],
          },
        ],
      },
      false,
    );
    const out: string = ed.storage.markdown.getMarkdown();
    expect(extractMentionHandles(out)).toEqual([WANG.handle]);
    ed.destroy();
    const again = makeEditor(out);
    expect(extractMentionHandles(again.storage.markdown.getMarkdown())).toEqual([WANG.handle]);
    again.destroy();
  });
});
