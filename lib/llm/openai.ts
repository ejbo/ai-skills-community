import type { LLMCompleteOptions, LLMProvider, LLMUsage } from './types';
import { iterateSseDeltas } from './sse';

/** Extract a text fragment from a parsed OpenAI-compatible stream event, or null. */
export function extractOpenAiDelta(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { choices?: Array<{ delta?: { content?: unknown } }> };
  const content = e.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content.length > 0 ? content : null;
}

interface OpenAiChatResponse {
  choices: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_MAX_TOKENS = 1024;

export class OpenAiProvider implements LLMProvider {
  readonly id = 'openai-compatible' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
  }

  private body(opts: LLMCompleteOptions, stream: boolean) {
    // OpenAI-compatible APIs take the system prompt as the first message.
    const messages = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...opts.messages]
      : opts.messages;
    return {
      model: opts.model ?? this.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
      messages,
    };
  }

  private async post(opts: LLMCompleteOptions, stream: boolean): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.body(opts, stream)),
    });
    if (!res.ok || (stream && !res.body)) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 240)}`);
    }
    return res;
  }

  async complete(opts: LLMCompleteOptions): Promise<{ text: string; usage: LLMUsage | null }> {
    const res = await this.post(opts, false);
    const json = (await res.json()) as OpenAiChatResponse;
    const text = json.choices?.[0]?.message?.content ?? '';
    return {
      text,
      usage: json.usage
        ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens }
        : null,
    };
  }

  async *streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string> {
    const res = await this.post(opts, true);
    yield* iterateSseDeltas(res.body as ReadableStream<Uint8Array>, extractOpenAiDelta);
  }
}
