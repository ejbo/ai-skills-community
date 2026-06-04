import { describe, it, expect } from 'vitest';
import { createHuaweiFetch, type HuaweiFetchConfig } from '@/lib/auth/huawei-fetch';

const BASE: Omit<HuaweiFetchConfig, 'baseFetch'> = {
  clientId: 'cid',
  clientSecret: 'sec',
  scope: 'base.profile',
  tokenUrl: 'https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken',
  userinfoUrl: 'https://uniportal.huawei.com/saaslogin1/oauth2/userinfo',
  verifySsl: true, // skip the undici dispatcher path in tests
};

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('huawei custom fetch', () => {
  it('reshapes the token exchange from form to JSON and injects token_type=bearer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const base: typeof fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      // Huawei's real response: no token_type, epoch-ms expires_in.
      return jsonResponse({ access_token: 'AT', refresh_token: 'RT', scope: 'base.profile', expires_in: 1650868657311 });
    }) as unknown as typeof fetch;

    const f = createHuaweiFetch({ ...BASE, baseFetch: base });
    // Auth.js/oauth4webapi would send a urlencoded body to the token endpoint:
    const resp = await f(BASE.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=CODE123&redirect_uri=' + encodeURIComponent('https://ai4news.rnd.huawei.com/skills/api/auth/callback/huawei'),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BASE.tokenUrl);
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toContain('application/json');
    const sentBody = JSON.parse(calls[0].init.body as string);
    expect(sentBody).toEqual({
      client_id: 'cid',
      client_secret: 'sec',
      redirect_uri: 'https://ai4news.rnd.huawei.com/skills/api/auth/callback/huawei',
      grant_type: 'authorization_code',
      code: 'CODE123',
    });

    const out = await resp.json();
    expect(out.token_type).toBe('bearer'); // injected
    expect(out.access_token).toBe('AT');
    expect(out.expires_in).toBeUndefined(); // epoch-ms value dropped, not passed through as bogus seconds
  });

  it('reshapes userinfo from GET+Bearer to a POST with a JSON body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const base: typeof fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ uid: '84412632', displayNameCn: '张三', email: 'zhangsan@huawei.com' });
    }) as unknown as typeof fetch;

    const f = createHuaweiFetch({ ...BASE, baseFetch: base });
    const resp = await f(BASE.userinfoUrl, { headers: { authorization: 'Bearer AT' } });

    expect(calls[0].url).toBe(BASE.userinfoUrl);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ client_id: 'cid', access_token: 'AT', scope: 'base.profile' });
    const profile = await resp.json();
    expect(profile.uid).toBe('84412632');
    expect(profile.displayNameCn).toBe('张三');
  });

  it('throws a clear error on an IDaaS errorCode body (e.g. reused code, HTTP 200)', async () => {
    const base: typeof fetch = (async () =>
      jsonResponse({ errorCode: 'E_20003', errorDesc: 'AuthCode has been used.' })) as unknown as typeof fetch;
    const f = createHuaweiFetch({ ...BASE, baseFetch: base });
    await expect(
      f(BASE.tokenUrl, { method: 'POST', body: 'grant_type=authorization_code&code=X&redirect_uri=Y' }),
    ).rejects.toThrow(/E_20003/);
  });

  it('passes non-Huawei URLs straight through to the base fetch', async () => {
    let hit = '';
    const base: typeof fetch = (async (url: string) => {
      hit = url;
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const f = createHuaweiFetch({ ...BASE, baseFetch: base });
    await f('https://example.com/whatever');
    expect(hit).toBe('https://example.com/whatever');
  });
});
