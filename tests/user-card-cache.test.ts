import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_CACHE_TTL_MS,
  freshCardEntry,
  invalidateUserCard,
  isCardView,
  loadCardView,
} from '@/components/user/card-cache';

// The hover card's fetch rules (components/user/card-cache.ts): only a card or a
// 404 is remembered, for 60 s, per viewer; 401/5xx are asked again; saves invalidate.

function view(handle: string, displayName = handle) {
  return { handle, displayName, theme: '#5b5bd6', card: { style: 'holo' }, badges: [], stats: [] };
}

function respond(status: number, body: unknown = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('user card cache', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateUserCard();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches once and serves the cached card within the TTL', async () => {
    fetchMock.mockImplementation(async () => respond(200, view('bob')));
    expect((await loadCardView('bob', 'u1'))?.handle).toBe('bob');
    expect((await loadCardView('bob', 'u1'))?.handle).toBe('bob');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/users/bob/card');
  });

  it('dedupes concurrent requests for the same member', async () => {
    fetchMock.mockImplementation(async () => respond(200, view('bob')));
    const [a, b] = await Promise.all([loadCardView('bob', 'u1'), loadCardView('bob', 'u1')]);
    expect(a?.handle).toBe('bob');
    expect(b?.handle).toBe('bob');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires entries after the TTL', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, view('bob', 'Old'))).mockResolvedValueOnce(respond(200, view('bob', 'New')));
    expect((await loadCardView('bob', 'u1'))?.displayName).toBe('Old');
    vi.setSystemTime(Date.now() + CARD_CACHE_TTL_MS + 1);
    expect(freshCardEntry('bob', 'u1')).toBeUndefined();
    expect((await loadCardView('bob', 'u1'))?.displayName).toBe('New');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never remembers a 401 — signing in must not leave cards broken', async () => {
    fetchMock.mockResolvedValueOnce(respond(401, { error: 'unauthenticated' })).mockResolvedValueOnce(respond(200, view('bob')));
    expect(await loadCardView('bob', null)).toBeNull();
    expect(freshCardEntry('bob', null)).toBeUndefined();
    expect((await loadCardView('bob', null))?.handle).toBe('bob');
  });

  it('never remembers a 5xx or a network error', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(respond(200, view('bob')));
    expect(await loadCardView('bob', 'u1')).toBeNull();
    expect(await loadCardView('bob', 'u1')).toBeNull();
    expect((await loadCardView('bob', 'u1'))?.handle).toBe('bob');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('remembers a 404 as "no card"', async () => {
    fetchMock.mockImplementation(async () => respond(404, { error: 'not_found' }));
    expect(await loadCardView('ghost', 'u1')).toBeNull();
    expect(freshCardEntry('ghost', 'u1')).toEqual({ view: null, at: Date.now() });
    expect(await loadCardView('ghost', 'u1')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops everything when the signed-in viewer changes', async () => {
    fetchMock.mockImplementation(async () => respond(200, view('bob')));
    await loadCardView('bob', 'u1');
    expect(freshCardEntry('bob', 'u1')).toBeDefined();
    expect(freshCardEntry('bob', 'u2')).toBeUndefined();
    await loadCardView('bob', 'u2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates one handle or all, and a request already in flight cannot repopulate', async () => {
    fetchMock.mockImplementation(async () => respond(200, view('bob')));
    await loadCardView('bob', 'u1');
    await loadCardView('alice', 'u1');
    invalidateUserCard('bob');
    expect(freshCardEntry('bob', 'u1')).toBeUndefined();
    expect(freshCardEntry('alice', 'u1')).toBeDefined();
    invalidateUserCard();
    expect(freshCardEntry('alice', 'u1')).toBeUndefined();

    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const pending = loadCardView('bob', 'u1'); // started before the save…
    invalidateUserCard('bob'); // …which lands while it is in flight
    release(respond(200, view('bob', 'Before save')));
    expect((await pending)?.displayName).toBe('Before save');
    expect(freshCardEntry('bob', 'u1')).toBeUndefined();
  });

  it('rejects payloads that are not a card view', () => {
    expect(isCardView(view('bob'))).toBe(true);
    expect(isCardView({ error: 'unauthenticated' })).toBe(false);
    expect(isCardView({ ...view('bob'), badges: null })).toBe(false);
    expect(isCardView(null)).toBe(false);
  });
});
