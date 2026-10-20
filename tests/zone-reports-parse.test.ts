// 版块报告 — 聊天记录解析（lib/zones/reports/parse.ts）与摘录 / 统计（digest.ts）。
// 钉住的契约：TXT 头行、表情码噪音、引用卡片定位、链接卡片、附件清单按时间对占位消息、名单。
import { describe, expect, it } from 'vitest';
import { parseChat, parseManifest, stripEmojiCodes, isNoiseText } from '@/lib/zones/reports/parse';
import { buildDigest, buildThemeBundle, computeStats } from '@/lib/zones/reports/digest';

const TXT = `WeLink 群 600916339024044374 聊天记录（共 8 条）
导出时间：2026-10-15 14:23:40
==================================================

[2026-09-20 07:08:22] 李思昊（l00974474）
还有一个我们要区分jev和jev-like

[2026-09-20 07:11:04] 白东峰（b00580378）
⁠/ZB⁠/ZB

[2026-09-20 07:12:18] 李思昊（l00974474）
https://x.com/vikramskr/status/2101314086462267587，段所

[2026-09-20 07:44:31] 李思昊（l00974474）
[图片/附件]

[2026-09-20 09:12:05] 李思昊（l00974474）
最新测试，iPhone18Pro Max 存储表现很糟糕

[2026-09-20 13:11:20] 周春华（z00885012）
{"cardContext":{"replyMsg":{"type":0,"content":"18pro 的大存储版本用的 flash 颗粒类型不一样"},"preMsg":{"nameZH":"李思昊","sender":"l00443349","messageID":"1","type":0,"content":"最新测试，iPhone18Pro Max 存储表现很糟糕","nameEN":"Li Sihao"}},"cardType":65}

[2026-09-24 10:19:01] Song Zhang（s00903640）
{ "digest" : "https:\\/\\/mobilesyrup.com\\/x", "imgUrl" : "\\/:um_begin{https:\\/\\/clouddrive.huawei.com\\/f\\/abc|Img|2564|thumb.png|0|101;101;CODE|isOriginalImg:0}\\/:um_end", "sourceUrl" : "https:\\/\\/mobilesyrup.com\\/2026\\/09\\/23\\/bell-cohere", "title" : "Bell, Cohere deploy cybersecurity AI" }

[2026-09-24 10:19:25] Song Zhang（s00903640）
是个有潜力的方向
`;

describe('parseChat (WeLink TXT)', () => {
  const chat = parseChat(TXT, { subject: '加研思想院', sourceName: 'x.txt' });

  it('parses every message with sequential ids, local dates and the roster', () => {
    expect(chat.messages).toHaveLength(8);
    expect(chat.messages[0]).toMatchObject({ id: 'm1', account: 'l00974474', name: '李思昊', date: '2026-09-20', type: 'text' });
    expect(chat.period).toEqual({ start: '2026-09-20', end: '2026-09-24' });
    expect(chat.roster.map((r) => r.account)).toEqual(['l00974474', 's00903640', 'b00580378', 'z00885012']);
    expect(chat.subject).toBe('加研思想院');
  });

  it('marks emoji-only messages as noise and image placeholders as image', () => {
    expect(chat.messages[1].type).toBe('noise');
    expect(chat.messages[3].type).toBe('image');
    expect(chat.messages[3].hasAttachmentPlaceholder).toBe(true);
  });

  it('extracts links without the trailing Chinese punctuation', () => {
    expect(chat.messages[2].links[0]).toMatchObject({ url: 'https://x.com/vikramskr/status/2101314086462267587', host: 'x.com' });
  });

  it('resolves a reply card to the quoted message even when the sender id is an old account', () => {
    const reply = chat.messages[5];
    expect(reply.type).toBe('reply');
    expect(reply.text).toContain('flash 颗粒');
    expect(reply.replyTo?.id).toBe('m5');
  });

  it('turns a share card into a link_card with title + sourceUrl and ignores the thumbnail um_begin', () => {
    const card = chat.messages[6];
    expect(card.type).toBe('link_card');
    expect(card.cardTitle).toBe('Bell, Cohere deploy cybersecurity AI');
    expect(card.links[0].url).toBe('https://mobilesyrup.com/2026/09/23/bell-cohere');
    expect(card.attachments).toHaveLength(0);
  });

  it('filters by date (inclusive) and renumbers', () => {
    const sept24 = parseChat(TXT, { from: '2026-09-24', to: '2026-09-24' });
    expect(sept24.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(() => parseChat(TXT, { from: '2027-01-01' })).toThrow();
    expect(() => parseChat('nothing here')).toThrow();
  });

  it('matches a manifest row to the placeholder message by sender + time (≤ 90 s)', () => {
    const manifest = parseManifest('﻿时间,发送人,姓名,类型,文件名,大小KB,外链,提取码,是否已下载\n2026-09-20 07:44,l00974474,李思昊,Img,A1.png,100,https://clouddrive.huawei.com/f/aaa,CODE1,是\n2026-09-21 00:00,b00580378,白东峰,File,orphan.pdf,900,https://clouddrive.huawei.com/f/bbb,CODE2,否\n');
    expect(manifest).toHaveLength(2);
    const withAssets = parseChat(TXT, { manifest, presentFiles: new Set(['A1.png']) });
    const img = withAssets.messages[3];
    expect(img.attachments).toEqual([expect.objectContaining({ file: 'A1.png', kind: 'image', present: true, msgId: 'm4', code: 'CODE1' })]);
    expect(withAssets.orphanAttachments).toEqual([expect.objectContaining({ file: 'orphan.pdf', kind: 'file', present: false })]);
  });

  it('accepts welink-cli JSON with names supplied', () => {
    const json = JSON.stringify([
      { msgId: '89495773562505322', sender: 'l00974474', serverSendTime: Date.UTC(2026, 8, 20, 7, 0, 0), contentType: 0, content: 'hello /:um_begin{https://clouddrive.huawei.com/f/x|Img|100|pic.png|0|1;1;K}/:um_end' },
    ]);
    const chat2 = parseChat(json, { names: { l00974474: '李思昊' } });
    expect(chat2.source.kind).toBe('welink-cli-json');
    expect(chat2.messages[0]).toMatchObject({ msgId: '89495773562505322', name: '李思昊', text: 'hello', hasAttachmentPlaceholder: true });
    expect(chat2.messages[0].attachments[0]).toMatchObject({ file: 'pic.png', code: 'K', kind: 'image' });
  });
});

describe('noise helpers', () => {
  it('strips WeLink emoji codes and leading punctuation', () => {
    expect(stripEmojiCodes('⁠/ZB，AMD新CPU')).toBe('AMD新CPU');
    expect(isNoiseText('⁠/ZB⁠/ZB')).toBe(true);
    expect(isNoiseText('@崔弘飞 @段俊杰')).toBe(true);
    expect(isNoiseText('好的')).toBe(true);
    expect(isNoiseText('这个在scale up域')).toBe(false);
  });
});

describe('digest + stats + bundles', () => {
  const chat = parseChat(TXT, { subject: '加研思想院' });
  const stats = computeStats(chat);

  it('counts substantive messages, speakers, days and links', () => {
    expect(stats.messages).toBe(8);
    expect(stats.substantive).toBe(6); // 4 text + 1 reply + 1 link_card（noise / image 不算）
    expect(stats.speakers).toBe(4);
    expect(stats.activeDays).toBe(2);
    expect(stats.links).toBe(2);
    expect(stats.bySpeaker[0]).toMatchObject({ account: 'l00974474', count: 4 });
  });

  it('builds a one-part digest that lists only substantive messages by id', () => {
    const { parts } = buildDigest(chat, stats);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('- m1 07:08 李思昊: 还有一个我们要区分jev和jev-like');
    expect(parts[0]).not.toContain('- m2 ');
    expect(parts[0]).toContain('↳m5');
    expect(parts[0]).toContain('〔链接卡片〕Bell, Cohere deploy cybersecurity AI');
  });

  it('splits by day when the digest exceeds maxChars', () => {
    const { parts } = buildDigest(chat, stats, 400);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain('第 1/');
  });

  it('builds a theme bundle with full text and the allowed url list', () => {
    const bundle = buildThemeBundle(chat, { id: 't1', title: 'T', tagline: 'x', msgIds: ['m7', 'm8', 'm1'] });
    expect(bundle).toContain('### m1 ·');
    expect(bundle.indexOf('### m1 ·')).toBeLessThan(bundle.indexOf('### m7 ·'));
    expect(bundle).toContain('- https://mobilesyrup.com/2026/09/23/bell-cohere');
  });
});
