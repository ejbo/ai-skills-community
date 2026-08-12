// 随刷短视频 — AI caption assist prompt + parser. SERVER-ONLY module: it pulls
// in extractJsonObject from lib/skill-assist, whose module graph reaches yauzl
// and node:crypto via lib/skill-parser. Client components import
// lib/video/shorts-shared instead — never this file.

import { extractJsonObject } from '@/lib/skill-assist';
import { MAX_SHORT_CAPTION_CHARS } from './shorts-shared';

export interface ShortCaptionPrompt {
  system: string;
  user: string;
  /**
   * Deliberately no maxTokens: the provider omits max_tokens from the wire when
   * unset, so a reasoning model's <think> block can't eat a fixed budget and
   * truncate the JSON answer (house rule — see lib/skill-assist.ts).
   */
  maxTokens?: number;
}

export function buildShortCaptionPrompt(draft: string): ShortCaptionPrompt {
  return {
    system:
      '你是一个短视频文案助手，帮助社区成员为竖屏短视频写吸引人的描述。' +
      '你只输出 JSON，不要任何解释、前后缀或 Markdown 代码围栏。',
    user:
      `作者为自己的短视频写了这段草稿描述：\n${draft}\n\n` +
      `请润色成一段更有吸引力的短视频文案：保留原意与关键信息，口语化、有节奏感，` +
      `不超过 ${MAX_SHORT_CAPTION_CHARS} 字；如合适可在结尾附 2-4 个 #话题 标签（与内容强相关，不要生造）。` +
      '语言跟随草稿的语言（中文草稿输出中文，英文草稿输出英文）。' +
      '只返回 JSON：{"caption": "..."}',
  };
}

/** Whitelisting normalizer over the single JSON gate; null when no usable reply. */
export function parseShortCaptionResult(text: string): string | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const caption = typeof obj.caption === 'string' ? obj.caption.trim() : '';
  if (!caption) return null;
  return caption.slice(0, MAX_SHORT_CAPTION_CHARS);
}
