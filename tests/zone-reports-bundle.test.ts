// 版块报告 — 整包上传的识别规则（lib/zones/reports/bundle.ts）。向导（浏览器）和流水线（服务端解 zip）
// 用的是同一份函数，所以这里钉住的就是用户在向导里看到、服务端也照做的那套规则。
import { describe, expect, it } from 'vitest';
import { bundleHasChat, mergeWelinkPages, namesFromBundle, planReportBundle } from '@/lib/zones/reports/bundle';

const f = (path: string, size = 10) => ({ path, size });

describe('planReportBundle', () => {
  it('recognises a WeLink export folder: largest txt + manifest csv + images / files; system junk is ignored', () => {
    const plan = planReportBundle([
      f('加研思想院_9月/加研思想院_300.txt', 5000),
      f('加研思想院_9月/readme.txt', 20),
      f('加研思想院_9月/加研思想院_9月_图片附件清单.csv', 300),
      f('加研思想院_9月/加研思想院_9月_图片附件/a.png', 100),
      f('加研思想院_9月/加研思想院_9月_图片附件/b.JPG', 100),
      f('加研思想院_9月/加研思想院_9月_图片附件/slides.pptx', 100),
      f('加研思想院_9月/.DS_Store', 1),
      f('__MACOSX/加研思想院_9月/._a.png', 1),
      f('加研思想院_9月/empty.md', 0),
    ]);
    expect(plan.source?.path).toBe('加研思想院_9月/加研思想院_300.txt');
    expect(plan.manifest?.path).toBe('加研思想院_9月/加研思想院_9月_图片附件清单.csv');
    expect(plan.importJson).toBeNull();
    expect(plan.assets.map((a) => [a.file.path.split('/').pop(), a.kind]).sort()).toEqual([
      ['a.png', 'image'],
      ['b.JPG', 'image'],
      ['readme.txt', 'file'],
      ['slides.pptx', 'file'],
    ]);
    expect(plan.ignored.map((i) => i.reason).sort()).toEqual(['empty', 'system', 'system']);
    expect(bundleHasChat(plan)).toBe(true);
  });

  it('prefers a csv whose name looks like a manifest and keeps the other csv as a file', () => {
    const plan = planReportBundle([f('chat.txt', 100), f('data.csv', 50), f('图片附件清单.csv', 50)]);
    expect(plan.manifest?.path).toBe('图片附件清单.csv');
    expect(plan.assets.map((a) => a.file.path)).toEqual(['data.csv']);
  });

  it('treats json files as welink-cli pages only when there is no txt', () => {
    const pages = planReportBundle([f('page1.json', 100), f('page2.json', 100), f('x.png', 1)]);
    expect(pages.source).toBeNull();
    expect(pages.sourcePages.map((p) => p.path)).toEqual(['page1.json', 'page2.json']);
    const single = planReportBundle([f('all.json', 100)]);
    expect(single.source?.path).toBe('all.json');
    const withTxt = planReportBundle([f('chat.txt', 100), f('messages.json', 100), f('other.json', 5)]);
    expect(withTxt.source?.path).toBe('chat.txt');
    expect(withTxt.ignored.map((i) => [i.file.path, i.reason])).toEqual([
      ['messages.json', 'skill_output'],
      ['other.json', 'json_with_txt'],
    ]);
  });

  it('switches to import mode on report.json and drops the skill side-products and work/ dir', () => {
    const plan = planReportBundle([
      f('out/report.json', 900),
      f('out/report.html', 90000),
      f('out/report.md', 3000),
      f('out/work/digest.md', 100),
      f('out/input.txt', 5000),
      f('out/attachments/a.png', 10),
      f('out/nested.zip', 10),
    ]);
    expect(plan.importJson?.path).toBe('out/report.json');
    expect(plan.source?.path).toBe('out/input.txt'); // 仍识别出来；流水线以 importKey 优先
    expect(plan.assets.map((a) => a.file.path)).toEqual(['out/attachments/a.png']);
    expect(plan.ignored.map((i) => i.reason).sort()).toEqual(['nested_zip', 'skill_output', 'skill_output', 'system']);
  });

  it('collects names.json and wl_names/*.json separately, and reports no chat when nothing fits', () => {
    const plan = planReportBundle([f('names.json', 10), f('wl_names/l00974474.json', 10), f('a.png', 1)]);
    expect(plan.names.map((n) => n.path)).toEqual(['names.json', 'wl_names/l00974474.json']);
    expect(bundleHasChat(plan)).toBe(false);
  });
});

describe('mergeWelinkPages / namesFromBundle', () => {
  it('merges pages by msgId, tolerating ansi noise and leading cli output', () => {
    const p1 = '\u001b[32mok\u001b[0m\n{"respData":{"chatInfo":[{"msgId":"1","content":"a"},{"msgId":"2","content":"b"}]}}';
    const p2 = '{"respData":{"chatInfo":[{"msgId":"2","content":"b"},{"msgId":"3","content":"c"}]}}';
    const merged = JSON.parse(mergeWelinkPages([p1, p2])) as { msgId: string }[];
    expect(merged.map((m) => m.msgId)).toEqual(['1', '2', '3']);
  });

  it('reads both name formats and lowercases accounts', () => {
    const names = namesFromBundle([
      { path: 'names.json', text: '{"L00974474":"李思昊","b00580378":"白东峰"}' },
      { path: 'wl_names/z00885012.json', text: '{"search_cli_person":{"data":[{"w3account":"Z00885012","chineseName":"周春华"}]}}' },
    ]);
    expect(names).toEqual({ l00974474: '李思昊', b00580378: '白东峰', z00885012: '周春华' });
  });
});
