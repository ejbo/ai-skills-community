import type { LLMCompleteOptions, LLMProvider, LLMUsage } from './types';
import { iterateSseDeltas } from './sse';

/** Extract a text fragment from a parsed Anthropic stream event, or null. */
export function extractAnthropicDelta(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
    return e.delta.text;
  }
  return null;
}

interface AnthropicMessagesResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
  }

  private body(opts: LLMCompleteOptions, stream: boolean) {
    return {
      model: opts.model ?? this.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
      // Cache the (large) system prompt across calls. Anthropic-specific; other
      // providers simply ignore the concept.
      ...(opts.system
        ? { system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }] }
        : {}),
      messages: opts.messages,
    };
  }

  private async post(opts: LLMCompleteOptions, stream: boolean): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.body(opts, stream)),
    });
    if (!res.ok || (stream && !res.body)) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 240)}`);
    }
    return res;
  }

  async complete(opts: LLMCompleteOptions): Promise<{ text: string; usage: LLMUsage | null }> {
    const res = await this.post(opts, false);
    const json = (await res.json()) as AnthropicMessagesResponse;
    const text = json.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
    return {
      text,
      usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null,
    };
  }

  async *streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string> {
    const res = await this.post(opts, true);
    yield* iterateSseDeltas(res.body as ReadableStream<Uint8Array>, extractAnthropicDelta);
  }
}
