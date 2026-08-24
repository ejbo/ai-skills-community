import { describe, expect, it } from 'vitest';
import {
  buildAuthCookies,
  canonicalRedirectTarget,
  hostnameOfHostHeader,
  isRedirectExemptHost,
} from '@/lib/auth/cookies';

describe('buildAuthCookies', () => {
  it('scopes names and paths for a secure subpath deploy', () => {
    const c = buildAuthCookies({ basePath: '/ai-community', secure: true });
    expect(c.sessionToken).toEqual({
      name: '__Secure-aic.session-token',
      options: { path: '/ai-community' },
    });
    for (const def of [c.callbackUrl, c.csrfToken, c.state, c.pkceCodeVerifier, c.nonce]) {
      expect(def.name.startsWith('__Secure-aic.')).toBe(true);
      expect(def.options.path).toBe('/ai-community/api/auth');
    }
    expect(c.state.name).toBe('__Secure-aic.state');
    expect(c.csrfToken.name).toBe('__Secure-aic.csrf-token');
    expect(c.pkceCodeVerifier.name).toBe('__Secure-aic.pkce.code_verifier');
  });

  it('uses unprefixed names and root paths at a root/http deploy', () => {
    const c = buildAuthCookies({ basePath: '', secure: false });
    expect(c.sessionToken).toEqual({ name: 'aic.session-token', options: { path: '/' } });
    expect(c.state).toEqual({ name: 'aic.state', options: { path: '/api/auth' } });
  });

  it('never uses __Host- (incompatible with non-root paths)', () => {
    const c = buildAuthCookies({ basePath: '/ai-community', secure: true });
    for (const def of Object.values(c)) expect(def.name.startsWith('__Host-')).toBe(false);
  });

  it('keeps the session-token name from being a prefix of any other cookie (chunk reader)', () => {
    const c = buildAuthCookies({ basePath: '', secure: false });
    const session = c.sessionToken.name;
    for (const def of [c.callbackUrl, c.csrfToken, c.state, c.pkceCodeVerifier, c.nonce]) {
      expect(def.name.startsWith(session)).toBe(false);
    }
  });
});

describe('hostnameOfHostHeader', () => {
  it('strips ports and lowercases', () => {
    expect(hostnameOfHostHeader('Cari.RND.huawei.com')).toBe('cari.rnd.huawei.com');
    expect(hostnameOfHostHeader('localhost:3000')).toBe('localhost');
    expect(hostnameOfHostHeader('10.1.2.3:3100')).toBe('10.1.2.3');
  });

  it('handles bracketed IPv6', () => {
    expect(hostnameOfHostHeader('[::1]:3000')).toBe('::1');
    expect(hostnameOfHostHeader('[::1]')).toBe('::1');
  });
});

describe('isRedirectExemptHost', () => {
  it('exempts loopback, IPs, and *.localhost', () => {
    expect(isRedirectExemptHost('localhost')).toBe(true);
    expect(isRedirectExemptHost('app.localhost')).toBe(true);
    expect(isRedirectExemptHost('127.0.0.1')).toBe(true);
    expect(isRedirectExemptHost('10.243.1.9')).toBe(true);
    expect(isRedirectExemptHost('::1')).toBe(true);
    expect(isRedirectExemptHost('')).toBe(true);
  });

  it('does not exempt real DNS names', () => {
    expect(isRedirectExemptHost('ai4news.rnd.huawei.com')).toBe(false);
    expect(isRedirectExemptHost('cari.rnd.huawei.com')).toBe(false);
  });
});

describe('canonicalRedirectTarget', () => {
  const base = {
    enableSso: true,
    authUrl: 'https://cari.rnd.huawei.com/ai-community/api/auth',
    basePath: '/ai-community',
  };

  it('redirects the legacy hostname alias to the canonical origin + basePath', () => {
    expect(canonicalRedirectTarget({ ...base, requestHost: 'ai4news.rnd.huawei.com' })).toBe(
      'https://cari.rnd.huawei.com/ai-community',
    );
  });

  it('serves the canonical host in place (port and case ignored)', () => {
    expect(canonicalRedirectTarget({ ...base, requestHost: 'cari.rnd.huawei.com' })).toBeNull();
    expect(canonicalRedirectTarget({ ...base, requestHost: 'CARI.rnd.huawei.com:443' })).toBeNull();
  });

  it('never redirects loopback/IP requests (smoke tests, direct-IP debugging)', () => {
    expect(canonicalRedirectTarget({ ...base, requestHost: '127.0.0.1:3100' })).toBeNull();
    expect(canonicalRedirectTarget({ ...base, requestHost: 'localhost:3100' })).toBeNull();
    expect(canonicalRedirectTarget({ ...base, requestHost: '10.243.1.9:3100' })).toBeNull();
  });

  it('is inert without SSO, without AUTH_URL, or when AUTH_URL is local dev', () => {
    expect(
      canonicalRedirectTarget({ ...base, enableSso: false, requestHost: 'ai4news.rnd.huawei.com' }),
    ).toBeNull();
    expect(
      canonicalRedirectTarget({ ...base, authUrl: null, requestHost: 'ai4news.rnd.huawei.com' }),
    ).toBeNull();
    expect(
      canonicalRedirectTarget({
        ...base,
        authUrl: 'http://localhost:3000',
        requestHost: 'some.dev.host',
      }),
    ).toBeNull();
    expect(
      canonicalRedirectTarget({ ...base, authUrl: 'not a url', requestHost: 'x.huawei.com' }),
    ).toBeNull();
  });

  it('targets the origin root at a root-path deploy', () => {
    expect(
      canonicalRedirectTarget({
        enableSso: true,
        authUrl: 'https://cari.rnd.huawei.com/api/auth',
        basePath: '',
        requestHost: 'ai4news.rnd.huawei.com',
      }),
    ).toBe('https://cari.rnd.huawei.com/');
  });
});
