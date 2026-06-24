import { describe, expect, it } from 'vitest';
import { resolveLLMConfig, DEFAULT_ANTHROPIC_MODEL } from '@/lib/llm/config';
import { parseSseData, encodeSseDelta, encodeSseError, iterateSseDeltas } from '@/lib/llm/sse';
import { extractAnthropicDelta } from '@/lib/llm/anthropic';
import { extractOpenAiDelta } from '@/lib/llm/openai';

describe('resolveLLMConfig', () => {
  it('defaults to anthropic + default model when nothing is set', () => {
    const c = resolveLLMConfig({});
    expect(c.provider).toBe('anthropic');
    expect(c.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(c.baseUrl).toBe('https://api.anthropic.com');
  });

  it('falls back to ANTHROPIC_API_KEY for the anthropic provider', () => {
    const c = resolveLLMConfig({ ANTHROPIC_API_KEY: 'sk-ant' });
    expect(c.provider).toBe('anthropic');
    expect(c.apiKey).toBe('sk-ant');
  });

  it('prefers LLM_API_KEY over ANTHROPIC_API_KEY', () => {
    const c = resolveLLMConfig({ LLM_API_KEY: 'sk-llm', ANTHROPIC_API_KEY: 'sk-ant' });
    expect(c.apiKey).toBe('sk-llm');
  });

  it('configures an openai-compatible provider from LLM_* vars', () => {
    const c = resolveLLMConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://gw.internal/v1',
      LLM_API_KEY: 'sk-x',
      LLM_MODEL: 'qwen-max',
    });
    expect(c.provider).toBe('openai-compatible');
    expect(c.baseUrl).toBe('https://gw.internal/v1');
    expect(c.apiKey).toBe('sk-x');
    expect(c.model).toBe('qwen-max');
  });

  it('does not borrow ANTHROPIC_API_KEY for a non-anthropic provider', () => {
    const c = resolveLLMConfig({ LLM_PROVIDER: 'openai-compatible', ANTHROPIC_API_KEY: 'sk-ant' });
    expect(c.apiKey).toBeUndefined();
  });

  it('resolves a keyless internal openai-compatible model (base + model, no key)', () => {
    // Internal vLLM/SGLang server with no auth — the common intranet case.
    const c = resolveLLMConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'http://10.212.16.36:8001/v1',
      LLM_MODEL: 'zai-org/GLM-5.1-FP8',
    });
    expect(c.provider).toBe('openai-compatible');
    expect(c.baseUrl).toBe('http://10.212.16.36:8001/v1');
    expect(c.model).toBe('zai-org/GLM-5.1-FP8');
    expect(c.apiKey).toBeUndefined();
  });

  it('lets LLM_MODEL override the anthropic default', () => {
    const c = resolveLLMConfig({ LLM_MODEL: 'claude-opus-4-8' });
    expect(c.model).toBe('claude-opus-4-8');
  });
});

describe('parseSseData', () => {
  it('extracts data payloads and keeps the incomplete tail as rest', () => {
    const { data, rest } = parseSseData('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(data).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  it('skips comment / event-only frames with no data line', () => {
    const { data } = parseSseData('event: ping\n\ndata: hello\n\n');
    expect(data).toEqual(['hello']);
  });

  it('joins multiple data lines within one event', () => {
    const { data } = parseSseData('data: line1\ndata: line2\n\n');
    expect(data).toEqual(['line1\nline2']);
  });
});

describe('encodeSse helpers', () => {
  it('encodes a normalized delta frame', () => {
    expect(encodeSseDelta('hi')).toBe('data: {"delta":"hi"}\n\n');
  });
  it('encodes an error frame', () => {
    expect(encodeSseError('boom')).toBe('data: {"error":"boom"}\n\n');
  });
});

describe('extractAnthropicDelta', () => {
  it('returns text for a content_block_delta text_delta', () => {
    expect(
      extractAnthropicDelta({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'abc' } }),
    ).toBe('abc');
  });
  it('returns null for non-text events', () => {
    expect(extractAnthropicDelta({ type: 'message_stop' })).toBeNull();
    expect(extractAnthropicDelta({ type: 'content_block_delta', delta: { type: 'input_json_delta' } })).toBeNull();
    expect(extractAnthropicDelta(null)).toBeNull();
  });
});

describe('extractOpenAiDelta', () => {
  it('returns the choices[0].delta.content', () => {
    expect(extractOpenAiDelta({ choices: [{ delta: { content: 'xyz' } }] })).toBe('xyz');
  });
  it('returns null when there is no content', () => {
    expect(extractOpenAiDelta({ choices: [{ delta: {} }] })).toBeNull();
    expect(extractOpenAiDelta({ choices: [{ delta: { content: '' } }] })).toBeNull();
    expect(extractOpenAiDelta(null)).toBeNull();
  });
});

describe('iterateSseDeltas', () => {
  function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i++]));
        } else {
          controller.close();
        }
      },
    });
  }

  it('yields normalized text deltas across awkwardly split chunks', async () => {
    const body = streamOf([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel',
      'lo"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    const out: string[] = [];
    for await (const d of iterateSseDeltas(body, extractAnthropicDelta)) out.push(d);
    expect(out.join('')).toBe('Hello world');
  });

  it('stops at an OpenAI [DONE] sentinel', async () => {
    const body = streamOf([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"c"}}]}\n\n',
    ]);
    const out: string[] = [];
    for await (const d of iterateSseDeltas(body, extractOpenAiDelta)) out.push(d);
    expect(out.join('')).toBe('ab');
  });

  it('processes a final frame that lacks a trailing blank line', async () => {
    // Some upstreams close right after the last event with no terminating "\n\n".
    const body = streamOf([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"first"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"last"}}',
    ]);
    const out: string[] = [];
    for await (const d of iterateSseDeltas(body, extractAnthropicDelta)) out.push(d);
    expect(out.join('')).toBe('firstlast');
  });

  it('flushes a multi-byte UTF-8 char split across read boundaries', async () => {
    // 😀 = F0 9F 98 80; split the frame's bytes mid-emoji across two chunks.
    const full = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"😀"}}]}\n\n',
    );
    const cut = full.indexOf(0xf0) + 2; // mid-emoji
    const byteBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(full.slice(0, cut));
        controller.enqueue(full.slice(cut));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const d of iterateSseDeltas(byteBody, extractOpenAiDelta)) out.push(d);
    expect(out.join('')).toBe('😀');
  });
});
