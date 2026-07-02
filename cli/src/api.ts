import type { Config } from './config.js';

interface FetchOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export class ApiClient {
  constructor(private readonly cfg: Config) {}

  private buildUrl(path: string): string {
    return `${this.cfg.registry.replace(/\/$/, '')}${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'user-agent': 'skills-cli/0.1.0', ...extra };
    if (this.cfg.token) h['authorization'] = `Bearer ${this.cfg.token}`;
    return h;
  }

  /** Turn a non-OK response into an actionable error (login / apply-for-access). */
  private async fail(res: Response): Promise<never> {
    type ErrBody = { error?: string; message?: string; applyUrl?: string };
    let body: ErrBody | null = null;
    try {
      body = (await res.json()) as ErrBody;
    } catch {
      /* non-JSON body */
    }
    if (res.status === 401) {
      throw new Error(
        `需要登录：运行 \`skills login\`（在 ${this.cfg.registry}/settings/tokens 创建 token）`,
      );
    }
    if (res.status === 403 && body?.error === 'needs_request') {
      throw new Error(
        `你还没有访问权限。请到 ${body.applyUrl ?? `${this.cfg.registry}`} 点击「申请下载」`,
      );
    }
    throw new Error(body?.message || `${res.status} ${res.statusText}`);
  }

  private async call(path: string, opts: FetchOptions = {}): Promise<unknown> {
    const headers = this.headers();
    if (opts.body) headers['content-type'] = 'application/json';
    const res = await fetch(this.buildUrl(path), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) await this.fail(res);
    return res.json();
  }

  search(query: string): Promise<{ items: Array<{ slug: string; name: string; summary: string; sourceType: string; downloadCount: number; avgRating: number }> }> {
    const qs = new URLSearchParams({ q: query, pageSize: '20' });
    return this.call(`/api/skills?${qs.toString()}`) as Promise<never>;
  }

  download(slug: string, version?: string): Promise<{ version: string; url: string | null; format: string; checksum: string | null; manifest: unknown }> {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    return this.call(`/api/skills/${slug}/download${qs}`, { auth: true }) as Promise<never>;
  }

  raw(slug: string, version?: string): string {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    return this.buildUrl(`/api/skills/${slug}/raw${qs}`);
  }

  /** Fetch the gated, attributed byte stream (zip or SKILL.md) with the Bearer token. */
  async rawFetch(slug: string, version?: string, via = 'install'): Promise<Response> {
    const qs = new URLSearchParams();
    if (version) qs.set('version', version);
    qs.set('via', via);
    const res = await fetch(this.buildUrl(`/api/skills/${slug}/raw?${qs.toString()}`), {
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res);
    return res;
  }

  /** Fetch an arbitrary URL with the Bearer token attached (for our own origin). */
  async fetchAuthed(url: string): Promise<Response> {
    const abs = url.startsWith('http') ? url : this.buildUrl(url);
    const res = await fetch(abs, { headers: this.headers() });
    if (!res.ok) await this.fail(res);
    return res;
  }

  /** Resolve a skill pack (`skills install pack:<slug>`) into its member slugs. */
  packManifest(slug: string): Promise<{
    slug: string;
    name: string;
    summary: string;
    skills: Array<{ slug: string; name: string; version: string | null }>;
  }> {
    // via=install bumps the pack's install counter server-side (once per run);
    // the per-skill download counts still land on each /raw fetch.
    return this.call(`/api/packs/${slug}/manifest?via=install`) as Promise<never>;
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
      auth: true,
    }) as Promise<never>;
  }
}
