import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Per-host egress routing. The invariant that matters on the intranet box:
 * turning the corporate proxy ON must not drag intranet hosts (uniportal, w3,
 * the 10.x vLLM) through it — that is what used to break W3 SSO the moment
 * 知识库 was made to work.
 *
 * lib/net/proxy reads `env` at call time but memoizes the resolved proxy URI,
 * so each case re-imports the module with a fresh module registry.
 */

const BASE_ENV = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  AUTH_SECRET: 'x'.repeat(32),
};

async function loadProxy(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(k, v);
  }
  return import('@/lib/net/proxy');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('egressFor', () => {
  it('sends public hosts through the proxy and intranet hosts direct', async () => {
    const { egressFor } = await loadProxy({
      USE_PROXY: 'true',
      HUAWEI_PROXY_HOST: 'proxyca.huawei.com',
      HUAWEI_PROXY_PORT: '8080',
    });

    const external = egressFor('https://mp.weixin.qq.com/s/abc');
    expect(external.via).toBe('proxy');
    expect(external.dispatcher).toBeDefined();
    expect(external.proxyUri).toBe('http://proxyca.huawei.com:8080');

    // The regression this whole module exists to prevent.
    for (const url of [
      'https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken',
      'https://w3.huawei.com/x',
      'http://10.212.16.36:8001/v1',
      'http://127.0.0.1:3100/api/health',
    ]) {
      const eg = egressFor(url);
      expect(eg.via, url).toBe('direct');
      expect(eg.dispatcher, url).toBeUndefined();
    }
  });

  it('is direct for everything when the proxy is off', async () => {
    const { egressFor } = await loadProxy({ USE_PROXY: 'false' });
    expect(egressFor('https://mp.weixin.qq.com/').via).toBe('direct');
  });

  it('accepts lenient boolean spellings for USE_PROXY', async () => {
    const { describeEgress } = await loadProxy({
      USE_PROXY: ' TRUE ',
      HUAWEI_PROXY_HOST: 'proxyca.huawei.com',
    });
    expect(describeEgress().proxyConfigured).toBe(true);
  });

  it('falls back to the standard HTTPS_PROXY var (undici ignores it on its own)', async () => {
    const { egressFor } = await loadProxy({ HTTPS_PROXY: 'http://proxyca.huawei.com:8080' });
    expect(egressFor('https://example.com/').via).toBe('proxy');
  });

  it('defaults the port and tolerates host:port / full-URI spellings', async () => {
    const bare = await loadProxy({ USE_PROXY: '1', HUAWEI_PROXY_HOST: 'proxyca.huawei.com' });
    expect(bare.egressFor('https://example.com/').proxyUri).toBe('http://proxyca.huawei.com:8080');

    const hostPort = await loadProxy({
      USE_PROXY: '1',
      HUAWEI_PROXY_HOST: 'proxyca.huawei.com:3128',
      HUAWEI_PROXY_PORT: '8080',
    });
    expect(hostPort.egressFor('https://example.com/').proxyUri).toBe('http://proxyca.huawei.com:3128');
  });

  it('treats a blank port as unset instead of collapsing to port 80', async () => {
    const { egressFor } = await loadProxy({
      USE_PROXY: 'true',
      HUAWEI_PROXY_HOST: 'proxyca.huawei.com',
      HUAWEI_PROXY_PORT: '   ',
    });
    expect(egressFor('https://example.com/').proxyUri).toBe('http://proxyca.huawei.com:8080');
  });

  it('reports a config error instead of silently going direct', async () => {
    const { describeEgress } = await loadProxy({ USE_PROXY: 'true' });
    expect(describeEgress().proxyConfigured).toBe(false);
    expect(describeEgress().configError).toMatch(/HUAWEI_PROXY_HOST/);
  });

  it('redacts proxy credentials', async () => {
    const { egressFor } = await loadProxy({
      USE_PROXY: 'true',
      HUAWEI_PROXY_HOST: 'http://user:secret@proxyca.huawei.com:8080',
    });
    const uri = egressFor('https://example.com/').proxyUri ?? '';
    expect(uri).not.toContain('secret');
    expect(uri).toContain('***');
  });
});

describe('hostBypassesProxy', () => {
  it('matches suffixes, exact hosts and IPv4 CIDRs from the default list', async () => {
    const { hostBypassesProxy } = await loadProxy({});
    expect(hostBypassesProxy('uniportal.huawei.com')).toBe(true);
    expect(hostBypassesProxy('huawei.com')).toBe(true);
    expect(hostBypassesProxy('localhost')).toBe(true);
    expect(hostBypassesProxy('10.212.16.36')).toBe(true);
    expect(hostBypassesProxy('192.168.1.5')).toBe(true);
    expect(hostBypassesProxy('mp.weixin.qq.com')).toBe(false);
    expect(hostBypassesProxy('8.8.8.8')).toBe(false);
    // Suffix matching must not fire on a lookalike domain.
    expect(hostBypassesProxy('nothuawei.com')).toBe(false);
    expect(hostBypassesProxy('huawei.com.evil.tld')).toBe(false);
  });

  it('honours an explicit PROXY_BYPASS list', async () => {
    const { hostBypassesProxy } = await loadProxy({ PROXY_BYPASS: 'example.com, 172.20.0.0/16' });
    expect(hostBypassesProxy('api.example.com')).toBe(true);
    expect(hostBypassesProxy('172.20.5.1')).toBe(true);
    // The default intranet entries no longer apply once overridden.
    expect(hostBypassesProxy('uniportal.huawei.com')).toBe(false);
  });
});

describe('INTERNAL_TLS_INSECURE', () => {
  it('relaxes TLS for intranet hosts only', async () => {
    const { egressFor } = await loadProxy({
      USE_PROXY: 'true',
      HUAWEI_PROXY_HOST: 'proxyca.huawei.com',
      INTERNAL_TLS_INSECURE: 'true',
    });
    expect(egressFor('https://w3.huawei.com/').via).toBe('direct-insecure');
    expect(egressFor('https://mp.weixin.qq.com/').via).toBe('proxy');
  });
});
