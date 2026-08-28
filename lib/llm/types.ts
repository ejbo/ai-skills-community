// Provider-agnostic LLM interface. Every LLM call in the app goes through a
// LLMProvider so the model/provider can be switched purely via env (see
// lib/llm/config.ts and lib/llm/index.ts) with no code changes.

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  input: number;
  output: number;
}

export interface LLMCompleteOptions {
  /** Assembled system prompt (e.g. the skill context). */
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  /** Override the provider's configured model for this call. */
  model?: string;
  /**
   * This call's reply must be a JSON object. Only acted on by providers that
   * can enforce it (OpenAI-compatible + jsonMode); everything still goes
   * through extractJsonObject, so it is a hint, never a guarantee.
   */
  json?: boolean;
  /**
   * Cancels the upstream request. The streaming routes thread `req.signal`
   * through: a reader who closes the chat drawer used to leave the generation
   * running against the shared model until it finished on its own.
   */
  signal?: AbortSignal;
}

export interface LLMCompletion {
  text: string;
  usage: LLMUsage | null;
  /**
   * Raw stop reason ('stop' | 'length' | 'max_tokens' | …), when the provider
   * reports one. `length`/`max_tokens` means the answer was CUT OFF — with a
   * reasoning model that usually means the whole budget went into <think> and
   * `text` is empty or half-written JSON, which is otherwise indistinguishable
   * from "the model ignored the format instruction".
   */
  finishReason?: string | null;
  /** Separated reasoning text, when the server splits it out (vLLM reasoning parser). */
  reasoning?: string | null;
}

export interface LLMProvider {
  readonly id: 'anthropic' | 'openai-compatible';
  readonly model: string;
  /** One-shot, non-streaming completion. */
  complete(opts: LLMCompleteOptions): Promise<LLMCompletion>;
  /** Streaming completion as a sequence of normalized text deltas. */
  streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string>;
}
