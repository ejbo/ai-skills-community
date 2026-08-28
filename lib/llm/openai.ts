import type { LLMCompleteOptions, LLMCompletion, LLMProvider } from './types';
import { acquireLlmSlot, completeDeadline, streamDeadline } from './limits';
import { iterateSseDeltas, stripThinkDeltas } from './sse';

/** Extract a text fragment from a parsed OpenAI-compatible stream event, or null. */
export function extractOpenAiDelta(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { choices?: Array<{ delta?: { content?: unknown } }> };
  const content = e.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content.length > 0 ? content : null;
}

interface OpenAiChatResponse {
  choices: Array<{
    message?: {
      content?: string;
      /**
       * vLLM/SGLang running a --reasoning-parser split the <think> block out of
       * `content` into this field. When the budget is exhausted inside it,
       * `content` comes back as "" and the request looks like a silent failure.
       */
      reasoning_content?: string;
      reasoning?: string;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface OpenAiProviderOptions {
  /** Optional — internal OpenAI-compatible servers (vLLM/SGLang) often need no key. */
  apiKey?: string;
  baseUrl: string;
  model: string;
  /**
   * Injected so this module stays env-free/testable. Callers pass `llmFetch`
   * (lib/llm/egress), which keeps the internal model on the direct route.
   */
  fetchImpl?: typeof fetch;
  /**
   * SELF-HOSTED vLLM/SGLang only. Sends `chat_template_kwargs.enable_thinking=false`
   * so a reasoning model answers directly instead of spending its budget inside
   * <think>. vLLM accepts-and-ignores unknown fields; api.openai.com returns a
   * 400, which is why this is opt-in per deployment and off by default.
   */
  disableThinking?: boolean;
  /** Ask for `response_format: json_object` (vLLM guided decoding). Same caveat. */
  jsonMode?: boolean;
}

export class OpenAiProvider implements LLMProvider {
  readonly id = 'openai-compatible' as const;
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly disableThinking: boolean;
  private readonly jsonMode: boolean;

  constructor(opts: OpenAiProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.disableThinking = opts.disableThinking ?? false;
    this.jsonMode = opts.jsonMode ?? false;
  }

  private body(opts: LLMCompleteOptions, stream: boolean) {
    // OpenAI-compatible APIs take the system prompt as the first message.
    const messages = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...opts.messages]
      : opts.messages;
    return {
      model: opts.model ?? this.model,
      // Omitted when unset: an explicit cap is what truncated reasoning models
      // mid-<think>, and vLLM/SGLang default to the remaining context window,
      // which is the behaviour we want. Callers only set it for tiny probes.
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      // Top-level, NOT nested under `extra_body` — that key is an artifact of the
      // OpenAI Python SDK and a raw fetch client must not reproduce it.
      ...(this.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      ...(this.jsonMode && opts.json ? { response_format: { type: 'json_object' } } : {}),
      stream,
      messages,
    };
  }

  private async post(opts: LLMCompleteOptions, stream: boolean, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // Only send Authorization when a key is configured — keyless internal servers can reject
    // a bare "Bearer " header.
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.body(opts, stream)),
      signal,
    });
    if (!res.ok || (stream && !res.body)) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 240)}`);
    }
    return res;
  }

  async complete(opts: LLMCompleteOptions): Promise<LLMCompletion> {
    const release = await acquireLlmSlot(opts.signal);
    // The deadline covers reading the body too, not just the response headers.
    const deadline = completeDeadline(opts.signal);
    try {
      const res = await this.post(opts, false, deadline.signal);
      const json = (await res.json()) as OpenAiChatResponse;
      const choice = json.choices?.[0];
      const message = choice?.message;
      return {
        text: message?.content ?? '',
        usage: json.usage
          ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens }
          : null,
        finishReason: choice?.finish_reason ?? null,
        reasoning: message?.reasoning_content ?? message?.reasoning ?? null,
      };
    } finally {
      deadline.dispose();
      release();
    }
  }

  async *streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string> {
    const release = await acquireLlmSlot(opts.signal);
    // Time to first byte only — the clock is stopped by the first UPSTREAM
    // frame, not the first visible delta: a reasoning model spends its opening
    // minutes inside <think>, which is real progress that yields no text.
    const deadline = streamDeadline(opts.signal);
    try {
      const res = await this.post(opts, true, deadline.signal);
      // A server without a --reasoning-parser streams <think> inline; strip it so
      // the chain of thought never lands in the user's chat bubble.
      yield* stripThinkDeltas(
        iterateSseDeltas(res.body as ReadableStream<Uint8Array>, extractOpenAiDelta, {
          onFrame: deadline.reached,
        }),
      );
    } finally {
      // Also runs when the consumer abandons the iterator (client disconnect),
      // which is what returns the slot for an answer nobody is reading.
      deadline.dispose();
      release();
    }
  }
}
