// 「聊天记录 → 报告」— 整包上传的识别规则（lib/zones/reports/bundle.ts）。向导（浏览器）和流水线（服务端解 zip）
// 用的是同一份函数。钉住的是 owner 2026-10-20 的要求：**按内容识别，不按文件名，而且不筛掉文件**——
// `page_001.txt` 里装着 welink-cli JSON 也要认出来；多份 JSON 合并；认不出内容的 json / txt 也排进候选末尾
// （guess），由服务端真解析决定用不用，而不是在这里就丢掉。
import { describe, expect, it } from 'vitest';
import { bundleHasChat, mergeWelinkPages, namesFromBundle, planReportBundle, sniffText, sureSources } from '@/lib/zones/reports/bundle';

const PAGE = '\u001b[32mok\u001b[0m\n{"respData":{"chatInfo":[{"msgId":"1","sender":"l00974474","serverSendTime":1758000000000,"contentType":"TEXT_MSG","content":"a"}]}}';
const ARRAY = '[{"msgId":"2","sender":"b00580378","serverSendTime":1758000001000,"contentType":"TEXT_MSG","content":"b"}]';
const TXT1 = 'WeLink 群 600 聊天记录（共 2 条）\n导出时间：2026-10-15\n====\n\n[2026-09-20 07:08:22] 李思昊（l00974474）\n还有一个\n';
const TXT2 = '加研思想院 2026 年 9 月消息记录\n\n#### 2026-09-20 ####\n\n[07:08:22] 李思昊（l00974474）· 文本\n还有一个\n';
const TXT3 = '2026/9/20 7:08 李思昊（l00974474）\n还有一个\n';
const CSV = '﻿时间,发送人,姓名,类型,文件名,大小KB,外链,提取码,是否已下载\n2026-09-20 07:08,l00974474,李思昊,图片,a.png,12,https://clouddrive/x,abcd,是\n';
const CSV_MSGS = '时间,发送人,姓名,内容\n2026-09-20 07:08:22,l00974474,李思昊,还有一个\n';
const IMAGES_JSON = '[{"time":"2026-09-20 07:08","sender":"l00974474","name":"李思昊","kind":"Img","size":12,"fname":"a.png","url":"https://clouddrive/x","code":"abcd"}]';
const DOWNLOADS = '[{"file":"a.png","ok":true},{"file":"b.png","ok":false}]';
const PERSON = '{"search_cli_person":{"data":[{"w3account":"L00974474","chineseName":"李思昊"}]}}';
const f = (path: string, head?: string, size = 10) => ({ path, size, head });
const names = (plan: ReturnType<typeof planReportBundle>) => plan.sources.map((s) => [s.file.path.split('/').pop(), s.kind, !!s.guess]);

describe('sniffText', () => {
  it('tells welink json pages / arrays, txt layouts, csv records, manifests and name lists apart by content', () => {
    expect(sniffText(PAGE, 'page_001.txt')).toBe('welink_json');
    expect(sniffText(ARRAY, 'welink-cli.json')).toBe('welink_json');
    expect(sniffText(TXT1, 'x.txt')).toBe('welink_txt');
    expect(sniffText(TXT2, 'x.txt')).toBe('welink_txt');
    expect(sniffText(TXT3, 'x.txt')).toBe('welink_txt');
    expect(sniffText(CSV, 'x.csv')).toBe('manifest');
    expect(sniffText(CSV_MSGS, 'x.csv')).toBe('welink_csv');
    expect(sniffText(IMAGES_JSON, 'images.json')).toBe('manifest');
    expect(sniffText(PERSON, 'wl.json')).toBe('names');
    expect(sniffText('{"l00974474":"李思昊"}', 'names.json')).toBe('names');
    expect(sniffText(DOWNLOADS, '_downloads.json')).toBe('other');
    expect(sniffText('{"schemaVersion":1,"kind":"monthly","themes":[]}', 'anything.json')).toBe('report_json');
    expect(sniffText('hello world', 'readme.txt')).toBe('other');
  });
});

describe('planReportBundle', () => {
  it('recognises welink json inside a .txt, lists every json source, and keeps unrecognised json as a guess instead of dropping it', () => {
    const plan = planReportBundle([
      f('加研思想院/page_001.txt', PAGE, 66_000),
      f('加研思想院/welink-cli.json', ARRAY, 900_000),
      f('加研思想院/_downloads.json', DOWNLOADS, 500),
      f('加研思想院/加研思想院_0920-1020_图片附件清单.csv', CSV, 300),
      f('加研思想院/wl_names/l00974474.json', PERSON),
      f('加研思想院/加研思想院_图片附件/a.png', undefined, 100),
      f('加研思想院/加研思想院_图片附件/slides.pptx', undefined, 100),
    ]);
    expect(names(plan)).toEqual([
      ['page_001.txt', 'welink_json', false],
      ['welink-cli.json', 'welink_json', false],
      ['_downloads.json', 'welink_json', true],
    ]);
    expect(sureSources(plan)).toHaveLength(2);
    expect(plan.manifest?.path).toContain('图片附件清单.csv');
    expect(plan.names).toHaveLength(1);
    expect(plan.assets.map((a) => [a.file.path.split('/').pop(), a.kind])).toEqual([
      ['a.png', 'image'],
      ['slides.pptx', 'file'],
    ]);
    expect(plan.ignored).toEqual([]);
    expect(bundleHasChat(plan)).toBe(true);
  });

  it('lists json first, then txt by size, then csv records, then guesses — the server parses them all and keeps the best', () => {
    const plan = planReportBundle([
      f('a/消息记录.txt', TXT2, 76_000),
      f('a/msgs.json', ARRAY, 203_000),
      f('a/small.txt', TXT1, 5000),
      f('a/records.csv', CSV_MSGS, 800),
      f('a/readme.txt', 'hello', 20),
      f('a/notes.md', '# notes', 20),
    ]);
    expect(names(plan)).toEqual([
      ['msgs.json', 'welink_json', false],
      ['消息记录.txt', 'welink_txt', false],
      ['small.txt', 'welink_txt', false],
      ['records.csv', 'welink_csv', false],
      ['notes.md', 'welink_txt', true],
      ['readme.txt', 'welink_txt', true],
    ]);
    // 认不出的文本同时还是附件（服务端选中当记录的那一个会从附件里去掉）
    expect(plan.assets.map((a) => a.file.path)).toEqual(['a/notes.md', 'a/readme.txt']);
    expect(plan.ignored).toEqual([]);
  });

  it('takes images.json as the manifest and a csv with a non-standard header as a plain file + guess candidate', () => {
    const plan = planReportBundle([f('a/chat.txt', TXT1, 100), f('a/images.json', IMAGES_JSON, 50), f('a/data.csv', 'x,y\n1,2\n', 50)]);
    expect(plan.manifest?.path).toBe('a/images.json');
    expect(plan.assets.map((a) => a.file.path)).toEqual(['a/data.csv']);
    expect(names(plan)).toEqual([
      ['chat.txt', 'welink_txt', false],
      ['data.csv', 'welink_csv', true],
    ]);
  });

  it('switches to import mode on report.json and drops system junk / nested zips / work dirs / skill intermediates', () => {
    const plan = planReportBundle([
      f('out/report.json', '{"schemaVersion":1,"kind":"monthly","themes":[{"id":"t1"}]}', 900),
      f('out/report.html', undefined, 90000),
      f('out/work/digest.md', 'x', 100),
      f('out/messages.json', '[{"id":1}]', 100),
      f('out/input.txt', TXT1, 5000),
      f('out/.DS_Store', undefined, 1),
      f('__MACOSX/out/._a.png', undefined, 1),
      f('out/nested.zip', undefined, 10),
      f('out/attachments/a.png', undefined, 10),
    ]);
    expect(plan.importJson?.path).toBe('out/report.json');
    expect(plan.sources.map((s) => s.file.path)).toEqual(['out/input.txt']); // 仍识别出来；流水线以 importKey 优先
    expect(plan.assets.map((a) => a.file.path)).toEqual(['out/attachments/a.png']);
    expect(plan.ignored.map((i) => i.reason).sort()).toEqual(['nested_zip', 'skill_output', 'skill_output', 'system', 'system', 'system']);
  });

  it('without heads falls back to extensions (json first, every txt still a candidate)', () => {
    const plan = planReportBundle([f('x/chat.txt', undefined, 100), f('x/page.json', undefined, 100), f('x/names.json', undefined, 10)]);
    expect(plan.sources.map((s) => s.kind)).toEqual(['welink_json', 'welink_txt']);
    expect(plan.names.map((n) => n.path)).toEqual(['x/names.json']);
    expect(plan.ignored).toEqual([]);
  });

  it('bundleHasChat is false only when there is no text file at all', () => {
    expect(bundleHasChat(planReportBundle([f('x/a.png', undefined, 10), f('x/b.pptx', undefined, 10)]))).toBe(false);
    expect(bundleHasChat(planReportBundle([f('x/whatever.txt', 'lorem ipsum', 10)]))).toBe(true);
  });
});

describe('mergeWelinkPages / namesFromBundle', () => {
  it('merges pages and arrays by msgId, tolerating ansi noise and leading cli output', () => {
    const merged = JSON.parse(mergeWelinkPages([PAGE, ARRAY, '{"respData":{"chatInfo":[{"msgId":"2","content":"dup"},{"msgId":"3","content":"c"}]}}'])) as { msgId: string }[];
    expect(merged.map((m) => m.msgId)).toEqual(['1', '2', '3']);
  });

  it('reads both name formats and lowercases accounts', () => {
    const names = namesFromBundle([
      { path: 'names.json', text: '{"L00974474":"李思昊","b00580378":"白东峰"}' },
      { path: 'wl_names/z00885012.json', text: '{"search_cli_person":{"data":[{"w3account":"Z00885012","chineseName":"周春华"}]}}' },
      { path: 'anything.json', text: PERSON },
    ]);
    expect(names).toEqual({ l00974474: '李思昊', b00580378: '白东峰', z00885012: '周春华' });
  });
});
