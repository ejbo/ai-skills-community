import { describe, expect, it } from 'vitest';
import {
  CONTENT_VISIBILITIES,
  MAX_AUDIENCE,
  canSeeByVisibility,
  isContentVisibility,
  newlyGrantedAudience,
  normalizeAudienceIds,
} from '@/lib/audience-shared';
import { voteHref } from '@/lib/votes/shared';

describe('canSeeByVisibility', () => {
  it('public is visible to everyone, owner always sees everything', () => {
    for (const visibility of CONTENT_VISIBILITIES) {
      expect(canSeeByVisibility({ visibility, isOwner: true, inAudience: false })).toBe(true);
    }
    expect(canSeeByVisibility({ visibility: 'public', isOwner: false, inAudience: false })).toBe(true);
  });

  it('private (隐藏) is owner/manager only — even a listed member is out', () => {
    expect(canSeeByVisibility({ visibility: 'private', isOwner: false, inAudience: true })).toBe(false);
  });

  it('audience needs the list', () => {
    expect(canSeeByVisibility({ visibility: 'audience', isOwner: false, inAudience: true })).toBe(true);
    expect(canSeeByVisibility({ visibility: 'audience', isOwner: false, inAudience: false })).toBe(false);
  });

  it('guards the enum', () => {
    expect(isContentVisibility('audience')).toBe(true);
    expect(isContentVisibility('restricted')).toBe(false);
    expect(isContentVisibility('toString')).toBe(false);
  });
});

describe('newlyGrantedAudience', () => {
  const live = (visibility: 'public' | 'private' | 'audience', audience: string[]) => ({ live: true, visibility, audience });

  it('tells only the names added to an audience list in force', () => {
    expect(newlyGrantedAudience(live('audience', ['a']), live('audience', ['a', 'b']))).toEqual(['b']);
  });

  it('switching to audience tells the whole list — unless it was public before', () => {
    expect(newlyGrantedAudience(live('private', ['a', 'b']), live('audience', ['a', 'b']))).toEqual(['a', 'b']);
    expect(newlyGrantedAudience(live('public', ['a']), live('audience', ['a']))).toEqual([]);
  });

  it('nobody is told about a draft or a list that is not in force', () => {
    const draft = { live: false, visibility: 'audience' as const, audience: ['a'] };
    expect(newlyGrantedAudience(draft, { ...draft, audience: ['a', 'b'] })).toEqual([]);
    expect(newlyGrantedAudience(live('audience', ['a']), live('private', ['a', 'b']))).toEqual([]);
  });

  it('publishing a draft that already had a list tells the list', () => {
    const before = { live: false, visibility: 'audience' as const, audience: ['a', 'b'] };
    expect(newlyGrantedAudience(before, { ...before, live: true })).toEqual(['a', 'b']);
  });

  it('dedupes', () => {
    expect(newlyGrantedAudience(live('private', []), live('audience', ['a', 'a']))).toEqual(['a']);
  });
});

describe('normalizeAudienceIds', () => {
  it('trims, dedupes, keeps order and drops the (implicit) owner', () => {
    expect(normalizeAudienceIds([' b ', 'a', 'b', '', 'owner'], 'owner')).toEqual(['b', 'a']);
  });

  it('caps at MAX_AUDIENCE', () => {
    const many = Array.from({ length: MAX_AUDIENCE + 10 }, (_, i) => `u${i}`);
    expect(normalizeAudienceIds(many, null)).toHaveLength(MAX_AUDIENCE);
  });
});

describe('voteHref', () => {
  it('links by title slug, percent-encoded, and falls back to the id', () => {
    expect(voteHref({ id: 'cabc', slug: 'ai-作品大赛' })).toBe(`/votes/${encodeURIComponent('ai-作品大赛')}`);
    expect(voteHref({ id: 'cabc', slug: null })).toBe('/votes/cabc');
    expect(voteHref({ id: 'cabc', slug: 'x' }, 'edit')).toBe('/votes/x/edit');
  });
});
