import type { LLMCompleteOptions, LLMCompletion, LLMProvider } from './types';
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
  /** 'end_turn' | 'max_tokens' | 'stop_sequence' | … — 'max_tokens' means truncated. */
  stop_reason?: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Injected so this module stays env-free/testable. Callers pass `llmFetch`
   * (lib/llm/egress); on the intranet an external api.anthropic.com additionally
   * needs LLM_USE_PROXY=true.
   */
  fetchImpl?: typeof fetch;
}

// Anthropic's Messages API REQUIRES max_tokens, so unlike the OpenAI-compatible
// provider this one cannot omit it. Kept generous so it never truncates an answer.
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
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
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
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

  async complete(opts: LLMCompleteOptions): Promise<LLMCompletion> {
    const res = await this.post(opts, false);
    const json = (await res.json()) as AnthropicMessagesResponse;
    const text = json.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
    return {
      text,
      usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null,
      finishReason: json.stop_reason ?? null,
    };
  }

  async *streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string> {
    const res = await this.post(opts, true);
    yield* iterateSseDeltas(res.body as ReadableStream<Uint8Array>, extractAnthropicDelta);
  }
}
