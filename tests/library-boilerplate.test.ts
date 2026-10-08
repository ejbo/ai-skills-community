import { describe, expect, it } from 'vitest';
import { stripBoilerplate } from '@/lib/library/boilerplate';
import { librarySourceKind, sourceDetail, sourceHost } from '@/lib/library/source';

const para = (i: number) =>
  `<p>第${i}段：推理服务的吞吐主要受显存带宽限制，连续批处理让新请求随时加入正在运行的批次，这样在高并发下 GPU 的利用率可以明显提升，而延迟只有很小的增加。</p>`;
const body = [
  '<h2>一、背景</h2>',
  para(1),
  para(2),
  '<p><img src="https://mmbiz.qpic.cn/mmbiz_png/figure1?wx_fmt=png" width="1080" height="600" alt=""></p>',
  para(3),
  para(4),
  para(5),
].join('');

const wechatHead =
  '<p><img src="https://mmbiz.qpic.cn/mmbiz_gif/banner?wx_fmt=gif" alt=""></p>' +
  '<p>点击上方“蓝字”关注我们</p>' +
  '<p></p>';
const wechatTail =
  '<p>往期推荐</p>' +
  '<p><a href="https://mp.weixin.qq.com/s/a">上一篇：vLLM 调优手记</a></p>' +
  '<p><a href="https://mp.weixin.qq.com/s/b">再上一篇：KV Cache 详解</a></p>' +
  '<p><img src="https://mmbiz.qpic.cn/mmbiz_jpg/qrcode?wx_fmt=jpeg" width="258" height="258" alt=""></p>' +
  '<p>扫码关注，第一时间获取更新</p>' +
  '<p>点个在看，你最好看</p>';

describe('stripBoilerplate — 公众号', () => {
  it('drops the 「点击蓝字关注」 opener (GIF banner + line) and the 往期推荐 / 扫码 / 在看 footer', () => {
    const r = stripBoilerplate(wechatHead + body + wechatTail, { wechat: true });
    expect(r.removedHead).toBe(3);
    expect(r.removedTail).toBe(6);
    expect(r.html.startsWith('<h2>一、背景</h2>')).toBe(true);
    expect(r.html.endsWith(para(5))).toBe(true);
    expect(r.html).not.toContain('mmbiz_gif');
    expect(r.html).not.toContain('qrcode');
    // the real figure in the body survives
    expect(r.html).toContain('figure1');
  });

  it('keeps a hero image that sits AFTER the boilerplate line (it belongs to the article)', () => {
    const hero = '<p><img src="https://mmbiz.qpic.cn/mmbiz_jpg/hero?wx_fmt=jpeg" width="1080" height="720" alt=""></p>';
    const r = stripBoilerplate('<p>点击上方蓝字关注我们</p>' + hero + body, { wechat: true });
    expect(r.removedHead).toBe(1);
    expect(r.html.startsWith(hero)).toBe(true);
  });

  it('leaves the head alone without a boilerplate signal — a plain hero figure is content', () => {
    const hero = '<p><img src="https://mmbiz.qpic.cn/mmbiz_jpg/hero?wx_fmt=jpeg" width="1080" height="720" alt=""></p>';
    const r = stripBoilerplate(hero + body, { wechat: true });
    expect(r.removedHead).toBe(0);
    expect(r.html).toBe(hero + body);
  });

  it('does not touch the head of a non-公众号 page, but still cuts a 推荐阅读 footer', () => {
    const r = stripBoilerplate(wechatHead + body + '<p>推荐阅读</p><p><a href="/x">另一篇</a></p>', { wechat: false });
    expect(r.removedHead).toBe(0);
    expect(r.removedTail).toBe(2);
    expect(r.html.startsWith(wechatHead)).toBe(true);
  });

  it('a 「相关阅读」 heading followed by real paragraphs is a section, not the footer', () => {
    const html = body + '<h2>相关阅读</h2>' + para(6) + para(7);
    const r = stripBoilerplate(html, { wechat: true });
    expect(r.removedTail).toBe(0);
    expect(r.html).toBe(html);
  });

  it('never cuts more than a third of the text or below the keep floor', () => {
    const tiny = '<p>点击上方蓝字关注我们</p><p>很短的正文。</p><p>往期推荐</p><p><a href="/a">一篇</a></p>';
    expect(stripBoilerplate(tiny, { wechat: true }).html).toBe(tiny);
    const mostlyFooter = para(1) + '<p>往期推荐</p>' + para(2) + para(3) + para(4);
    // the "footer" would be 3 real paragraphs → the trigger is rejected
    expect(stripBoilerplate(mostlyFooter, { wechat: true }).html).toBe(mostlyFooter);
  });

  it('without a trigger, only trailing QR-sized images and empty blocks go; a closing chart stays', () => {
    const qr = '<p><img src="https://example.com/i/qr.png" width="200" height="200" alt="二维码"></p>';
    const r = stripBoilerplate(body + qr + '<p></p>', { wechat: false });
    expect(r.removedTail).toBe(2);
    const chart = '<p><img src="https://example.com/i/chart.png" width="1200" height="800" alt=""></p>';
    expect(stripBoilerplate(body + chart, { wechat: false }).html).toBe(body + chart);
  });

  it('is a no-op on tiny fragments and on empty input', () => {
    expect(stripBoilerplate('<p>往期推荐</p><p>x</p>', { wechat: true }).html).toBe('<p>往期推荐</p><p>x</p>');
    expect(stripBoilerplate('', { wechat: true }).html).toBe('');
  });
});

describe('librarySourceKind', () => {
  it('classifies known hosts, folds www., and treats files as `file`', () => {
    expect(librarySourceKind({ sourceUrl: 'https://mp.weixin.qq.com/s/abc' })).toBe('wechat');
    expect(librarySourceKind({ sourceUrl: 'https://zhuanlan.zhihu.com/p/1' })).toBe('zhihu');
    expect(librarySourceKind({ sourceUrl: 'https://www.arxiv.org/abs/1706.03762' })).toBe('arxiv');
    expect(librarySourceKind({ sourceUrl: 'https://github.com/x/y' })).toBe('github');
    expect(librarySourceKind({ sourceUrl: 'https://someblog.io/post' })).toBe('web');
    expect(librarySourceKind({ sourceUrl: null, format: 'pdf' })).toBe('file');
    expect(librarySourceKind({ sourceUrl: 'not a url' })).toBe('file');
    expect(sourceHost('https://www.Example.com/a')).toBe('example.com');
  });

  it('sourceDetail prints the 公众号 account, the host for plain web pages, nothing for files', () => {
    expect(sourceDetail({ sourceUrl: 'https://mp.weixin.qq.com/s/abc', siteName: '机器之心' })).toBe('机器之心');
    expect(sourceDetail({ sourceUrl: 'https://mp.weixin.qq.com/s/abc', siteName: null })).toBeNull();
    expect(sourceDetail({ sourceUrl: 'https://someblog.io/post', siteName: 'someblog.io' })).toBe('someblog.io');
    expect(sourceDetail({ sourceUrl: 'https://someblog.io/post', siteName: 'Some Blog' })).toBe('Some Blog');
    expect(sourceDetail({ sourceUrl: 'https://arxiv.org/abs/1', siteName: 'arxiv.org' })).toBeNull();
    expect(sourceDetail({ sourceUrl: null, siteName: null, format: 'pdf' })).toBeNull();
  });
});
