import { describe, expect, it } from 'vitest';
import { GLUED_IMAGE_TARGETS, gluedImageTargetLabel, repairGluedImages, selectGluedImageTargets } from '@/lib/glued-images';
import { bodyFileKeys } from '@/lib/zones/shared';
import { splitPollSegments } from '@/lib/polls-shared';

const fix = (md: string, opts?: Parameters<typeof repairGluedImages>[1]) => repairGluedImages(md, opts);

describe('repairGluedImages — the serializer shape is repaired', () => {
  it('splits a paragraph glued to a top-level image with a blank line', () => {
    const r = fix('intro\n\n![pic](/labs/toronto.jpg)below');
    expect(r.text).toBe('intro\n\n![pic](/labs/toronto.jpg)\n\nbelow');
    expect(r.fixes).toBe(1);
    expect(r.samples[0]).toContain('⏎below');
  });

  it('repairs every block kind the critic probe produced', () => {
    expect(fix('![a](/a.jpg)## H').text).toBe('![a](/a.jpg)\n\n## H');
    expect(fix('![a](/a.jpg)- item').text).toBe('![a](/a.jpg)\n\n- item');
    expect(fix('![a](/a.jpg)> q').text).toBe('![a](/a.jpg)\n\n> q');
    expect(fix('![a](/a.jpg)| h | g |\n| --- | --- |\n| c | d |').text).toBe('![a](/a.jpg)\n\n| h | g |\n| --- | --- |\n| c | d |');
    expect(fix('<img src="/a.jpg" alt="" width="320">## H').text).toBe('<img src="/a.jpg" alt="" width="320">\n\n## H');
    expect(fix('![a](/a\\(1\\).jpg "t")after').text).toBe('![a](/a\\(1\\).jpg "t")\n\nafter');
  });

  it('a glued fence opener starts a code block, and code inside it is never touched', () => {
    const md = 'x\n\n![a](/a.jpg)```js\n![b](/b.jpg)inside code\n```\n\nafter';
    const r = fix(md);
    expect(r.text).toBe('x\n\n![a](/a.jpg)\n\n```js\n![b](/b.jpg)inside code\n```\n\nafter');
    expect(r.fixes).toBe(1);
    const fenced = '```md\n![a](/a.jpg)text\n```';
    expect(fix(fenced).fixes).toBe(0);
    const tilde = '~~~\n![a](/a.jpg)text\n~~~\n\n![c](/c.jpg)real';
    expect(fix(tilde).text).toBe('~~~\n![a](/a.jpg)text\n~~~\n\n![c](/c.jpg)\n\nreal');
  });

  it('restores own-line embed and poll tokens, so the reader and bodyFileKeys see them again', () => {
    const glued = 'intro\n\n![a](/a.jpg)[embed:file:file/abcdefghij.pdf]\n\n![b](/b.jpg)[poll:abcdefgh12]';
    expect(bodyFileKeys(glued)).toEqual([]);
    const r = fix(glued);
    expect(r.fixes).toBe(2);
    expect(bodyFileKeys(r.text)).toEqual(['file/abcdefghij.pdf']);
    expect(splitPollSegments(r.text).some((s) => s.type === 'poll')).toBe(true);
  });

  it('splits image runs by default, and leaves them for README-style bodies', () => {
    const md = '![a](/a.jpg)![b](/b.jpg)after';
    expect(fix(md).text).toBe('![a](/a.jpg)\n\n![b](/b.jpg)\n\nafter');
    expect(fix(md).fixes).toBe(2);
    expect(fix('![CI](/ci.svg)![npm](/npm.svg)', { splitImageRuns: false }).fixes).toBe(0);
    // an image followed by a sticker paragraph is still glue
    expect(fix('![a](/a.jpg)![](/api/uploads/stickers/s1.png)').fixes).toBe(1);
  });

  it('keeps the following block inside its blockquote or list item', () => {
    expect(fix('> ![a](/a.jpg)after').text).toBe('> ![a](/a.jpg)\n>\n> after');
    expect(fix('> > ![a](/a.jpg)after').text).toBe('> > ![a](/a.jpg)\n> >\n> > after');
    expect(fix('- ![a](/a.jpg)after').text).toBe('- ![a](/a.jpg)\n\n  after');
    expect(fix('1. ![a](/a.jpg)after').text).toBe('1. ![a](/a.jpg)\n\n   after');
    // tight list: the next child of the item is on the very next, indented line
    expect(fix('- para\n  ![a](/a.jpg)after').text).toBe('- para\n  ![a](/a.jpg)\n\n  after');
  });

  it('is idempotent and preserves CRLF line endings', () => {
    const once = fix('a\r\n\r\n![a](/a.jpg)## H\r\nnext').text;
    expect(once).toBe('a\r\n\r\n![a](/a.jpg)\r\n\r\n## H\r\nnext');
    expect(fix(once).fixes).toBe(0);
    const md = '![a](/a.jpg)![b](/b.jpg)x\n\n> ![c](/c.jpg)y';
    expect(fix(fix(md).text).fixes).toBe(0);
  });
});

describe('repairGluedImages — hand-written inline images are left alone', () => {
  it('never splits an image inside a sentence or followed by whitespace', () => {
    for (const md of ['see ![a](/a.jpg) here', 'see ![a](/a.jpg)here', '![a](/a.jpg) here', '![a](/a.jpg)', '[![a](/a.jpg)](/x)after']) {
      const r = fix(md);
      expect(r.fixes).toBe(0);
      expect(r.text).toBe(md);
    }
  });

  it('never splits a paragraph continuation line (the plain comment box appends images that way)', () => {
    expect(fix('hello\n![](/api/uploads/images/a.png)nice').fixes).toBe(0);
  });

  it('never splits text after a sticker (stickers are inline)', () => {
    expect(fix('![sticker](/api/uploads/stickers/abc.png)哈哈').fixes).toBe(0);
    expect(fix('<img src="/api/uploads/stickers/abc.png" alt="" width="40">哈哈').fixes).toBe(0);
  });

  it('treats a trailing hard break and closing punctuation as not glue, an escaped leading char as glue', () => {
    expect(fix('![a](/a.jpg)\\\nnext').fixes).toBe(0);
    expect(fix('![a](/a.jpg)，然后').fixes).toBe(0);
    expect(fix('![a](/a.jpg)).').fixes).toBe(0);
    expect(fix('![a](/a.jpg)\\*starred\\*').text).toBe('![a](/a.jpg)\n\n\\*starred\\*');
  });

  it('leaves image forms the serializer never writes', () => {
    for (const md of ['![a](<with space.jpg>)x', "![a](/a.jpg 'single')x", '<img src="/a.jpg">x', '<img alt="" src="/a.jpg" width="3">x']) {
      expect(fix(md).fixes).toBe(0);
    }
  });

  it('returns the same string instance semantics for bodies without images', () => {
    const md = 'no images here\n\n## heading';
    expect(fix(md)).toEqual({ text: md, fixes: 0, samples: [] });
    expect(fix('')).toEqual({ text: '', fixes: 0, samples: [] });
  });
});

describe('repairGluedImages — shapes the serializer never wrote are left byte-for-byte', () => {
  const unchanged = (md: string, opts?: Parameters<typeof repairGluedImages>[1]) => {
    const r = fix(md, opts);
    expect(r.fixes, JSON.stringify(md)).toBe(0);
    expect(r.text).toBe(md);
  };

  it('indented code — at top level and inside a list item — is code, not a container', () => {
    unchanged('Example:\n\n    ![logo](/logo.png)Welcome\n    more code');
    unchanged('Example:\n\n\t![logo](/logo.png)Welcome');
    unchanged('- item\n\n      ![a](/a.png)text');
    unchanged('code:\n\n    - ![a](/a.png)text\n    - ![b](/b.png)more');
    // indentation alone, no list: a hand-written paragraph
    unchanged('intro\n\n   ![a](/a.png)text');
    unchanged('intro\n  ![a](/a.png)text');
  });

  it('verbatim HTML blocks run across blank lines until their closer', () => {
    unchanged('<pre>\n\n![a](/a.png)text\n</pre>');
    unchanged('<!--\n\n![a](/a.png)x\n\n-->');
    unchanged('<script type="text/markdown">\n\n![a](/a.png)x\n</script>');
    unchanged('> <textarea>\n>\n> ![a](/a.png)x\n> </textarea>');
    // ...and the text AFTER the closer is ordinary again
    expect(fix('<!-- note -->\n\n![a](/a.png)after').text).toBe('<!-- note -->\n\n![a](/a.png)\n\nafter');
    expect(fix('<pre>x</pre>\n\n![a](/a.png)after').fixes).toBe(1);
  });

  it('HTML the serializer never glues a block with: <br>, a closing tag', () => {
    unchanged('![a](/a.png)<br>caption');
    unchanged('<p align="center">\n\n<img src="/a.png" alt="a" width="100"></p>');
    unchanged('![a](/a.png)</div>');
  });

  it('a setext underline or a same-width table delimiter on the next line makes it a header', () => {
    unchanged('![a](/a.png)Title\n=====');
    unchanged('![a](/a.png)Title\n---');
    unchanged('> ![a](/a.png)Title\n> ===');
    unchanged('![a](/a.png)text | b\n--- | ---\n1 | 2');
    unchanged('![a](/a.png)text | b |\n| --- | --- |');
  });

  it('a shallower line closes the list item, so a later line at its old column is not its child', () => {
    unchanged('- item\n# Heading\n  ![a](/a.png)text');
    unchanged('- item\nlazy\n\n  ![a](/a.png)text');
  });

  it('a fence closer is never read after a list marker (`- ```` inside code is content)', () => {
    unchanged('```md\n- ```\n\n![a](/a.png)text\n```');
  });
});

describe('repairGluedImages — the narrowing does not lose real serializer glue', () => {
  it('a paragraph that opens with a formatting span, and an image run into a resized image', () => {
    expect(fix('![a](/x.png)<span data-color="red">t</span>').text).toBe('![a](/x.png)\n\n<span data-color="red">t</span>');
    expect(fix('![a](/x.png)<img src="/b.png" alt="" width="3">').text).toBe('![a](/x.png)\n\n<img src="/b.png" alt="" width="3">');
  });

  it('an ordered item continuation indented to its content column (not indented code)', () => {
    expect(fix('10. p\n\n    ![a](/x.png)after').text).toBe('10. p\n\n    ![a](/x.png)\n\n    after');
    expect(fix('- p\n\n  - q\n\n    ![a](/x.png)after').text).toBe('- p\n\n  - q\n\n    ![a](/x.png)\n\n    after');
    // a 4-space bullet body is still a list item, not code
    expect(fix('-   p\n\n    ![a](/x.png)after').fixes).toBe(1);
  });

  it('a glued table header with one cell too many is still split', () => {
    expect(fix('![a](/a.jpg)| h |\n| --- |').text).toBe('![a](/a.jpg)\n\n| h |\n| --- |');
  });

  it('a glued list remainder opens a list whose next child is repaired too', () => {
    expect(fix('![a](/a.jpg)- item\n  ![b](/b.jpg)more').text).toBe('![a](/a.jpg)\n\n- item\n  ![b](/b.jpg)\n\n  more');
  });
});

describe('repair targets', () => {
  const labels = (ts: readonly { model: string; field: string }[]) => ts.map(gluedImageTargetLabel);

  it('an icon list is indistinguishable from glue — which is why README / textarea fields are opt-in', () => {
    // The serializer wrote exactly this for a list item [image, paragraph]; a README icon list looks the same.
    expect(fix('- ![py](/py.png)Python\n- ![go](/go.png)Go').fixes).toBe(2);
    const optIn = labels(GLUED_IMAGE_TARGETS.filter((t) => t.optIn));
    expect(optIn).toEqual(expect.arrayContaining(['Skill.descriptionMd', 'VideoComment.bodyMd']));
    expect(labels(selectGluedImageTargets(null))).not.toContain('Skill.descriptionMd');
    expect(labels(selectGluedImageTargets(null))).not.toContain('VideoComment.bodyMd');
    expect(labels(selectGluedImageTargets(null))).toContain('ZonePost.bodyMd');
  });

  it('--only names what to scan, opt-in fields included', () => {
    expect(labels(selectGluedImageTargets(new Set(['Skill.descriptionMd', 'Event.descriptionMd'])))).toEqual([
      'Event.descriptionMd',
      'Skill.descriptionMd',
    ]);
    expect(GLUED_IMAGE_TARGETS.find((t) => t.model === 'Skill')?.splitImageRuns).toBe(false);
  });
});
