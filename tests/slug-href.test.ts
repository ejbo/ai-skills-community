import { describe, expect, it } from 'vitest';
import {
  announcementHref,
  eventHref,
  feedbackHref,
  linkSegment,
  needsCanonicalRedirect,
  topicHref,
  videoHref,
} from '@/lib/slug-href';
import { zonePostEditHref, zonePostHref, zoneWikiHref } from '@/lib/zones/shared';

describe('title-slug hrefs', () => {
  it('prefer the slug, fall back to the id for legacy rows', () => {
    expect(eventHref({ id: 'cm1', slug: 'ai-大会' })).toBe(`/events/${encodeURIComponent('ai-大会')}`);
    expect(eventHref({ id: 'cm1', slug: null })).toBe('/events/cm1');
    expect(topicHref({ id: 'cm2' })).toBe('/discussion/topics/cm2');
    expect(feedbackHref('cm3')).toBe('/feedback/cm3');
    expect(announcementHref({ id: 'cm4', slug: 'v2-上线' })).toBe(`/announcements/${encodeURIComponent('v2-上线')}`);
  });

  it('percent-encode CJK so the link survives redirect() and stored notifications', () => {
    const seg = linkSegment({ id: 'x', slug: '大模型推理' });
    expect(seg).toBe('%E5%A4%A7%E6%A8%A1%E5%9E%8B%E6%8E%A8%E7%90%86');
    expect(decodeURIComponent(seg)).toBe('大模型推理');
    expect(videoHref('部署-实战')).toBe(`/videos/${encodeURIComponent('部署-实战')}`);
    expect(zoneWikiHref('infra', '部署指南')).toBe(`/zones/infra/wiki/${encodeURIComponent('部署指南')}`);
  });

  it('zone post view links carry the slug; edit links stay on the id', () => {
    expect(zonePostHref('infra', { id: 'cm5', slug: '推理优化' })).toBe(`/zones/infra/posts/${encodeURIComponent('推理优化')}`);
    expect(zonePostHref('infra', 'cm5')).toBe('/zones/infra/posts/cm5');
    // A draft's slug follows its title on autosave — the composer URL must not go stale.
    expect(zonePostEditHref('infra', 'cm5')).toBe('/zones/infra/posts/cm5/edit');
  });
});

describe('needsCanonicalRedirect', () => {
  it('redirects an id or a retired slug to the live slug, never a legacy row or the slug itself', () => {
    expect(needsCanonicalRedirect({ slug: 'ai-大会', canonical: false })).toBe(true);
    expect(needsCanonicalRedirect({ slug: 'ai-大会', canonical: true })).toBe(false);
    expect(needsCanonicalRedirect({ slug: null, canonical: false })).toBe(false);
  });
});
