import type { Config } from './config.js';

interface FetchOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private async call(path: string, opts: FetchOptions = {}): Promise<unknown> {
    const url = `${this.cfg.registry.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'user-agent': 'skills-cli/0.1.0',
    };
    if (opts.body) headers['content-type'] = 'application/json';
    if (opts.auth && this.cfg.token) headers['authorization'] = `Bearer ${this.cfg.token}`;
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  search(query: string): Promise<{ items: Array<{ slug: string; name: string; summary: string; sourceType: string; downloadCount: number; avgRating: number }> }> {
    const qs = new URLSearchParams({ q: query, pageSize: '20' });
    return this.call(`/api/skills?${qs.toString()}`) as Promise<never>;
  }

  download(slug: string, version?: string): Promise<{ version: string; url: string | null; inline: string | null; checksum: string | null; manifest: unknown }> {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    return this.call(`/api/skills/${slug}/download${qs}`) as Promise<never>;
  }

  raw(slug: string, version?: string): string {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    return `${this.cfg.registry.replace(/\/$/, '')}/api/skills/${slug}/raw${qs}`;
  }

  checkUpdates(installed: Array<{ slug: string; installed_version?: string }>): Promise<{
    results: Array<{
      slug: string;
      found: boolean;
      installed_version?: string;
      latest_version?: string;
      has_update?: boolean;
      download_url?: string;
      checksum?: string | null;
    }>;
  }> {
    return this.call('/api/skills/check-updates', {
      method: 'POST',
      body: { installed },
    }) as Promise<never>;
  }
}
