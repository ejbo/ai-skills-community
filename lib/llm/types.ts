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
}

export interface LLMProvider {
  readonly id: 'anthropic' | 'openai-compatible';
  readonly model: string;
  /** One-shot, non-streaming completion. */
  complete(opts: LLMCompleteOptions): Promise<{ text: string; usage: LLMUsage | null }>;
  /** Streaming completion as a sequence of normalized text deltas. */
  streamDeltas(opts: LLMCompleteOptions): AsyncIterable<string>;
}
