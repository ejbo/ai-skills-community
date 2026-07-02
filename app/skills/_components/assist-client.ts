import type { AssistAction, AssistResult, AssistCurrent, PackSkillInput } from '@/lib/skill-assist';

export interface AssistError {
  kind: 'unconfigured' | 'rate_limited' | 'error' | 'no_content';
  message: string;
}

export interface AssistPayload {
  action: AssistAction;
  /** Skill text — required for every action except `pack`. */
  skillMd?: string;
  readme?: string | null;
  files?: { path: string; content: string }[];
  /** Member skills — the `pack` action reads these instead of skillMd. */
  packSkills?: PackSkillInput[];
  current?: AssistCurrent;
}

/** Call the unified AI assist endpoint. Throws a typed AssistError on failure. */
export async function requestAssist(payload: AssistPayload): Promise<AssistResult> {
  if (payload.action === 'pack') {
    if (!payload.packSkills?.length) {
      throw { kind: 'no_content', message: '先给合集包添加至少一个 skill，AI 才能生成介绍。' } as AssistError;
    }
  } else if (!payload.skillMd?.trim()) {
    throw { kind: 'no_content', message: '先添加 SKILL.md 内容，AI 才能读取生成。' } as AssistError;
  }
  let res: Response;
  try {
    res = await fetch('/api/skills/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw { kind: 'error', message: '网络错误，请重试。' } as AssistError;
  }
  if (res.status === 503) {
    throw { kind: 'unconfigured', message: '服务端未配置 AI，无法使用智能生成。' } as AssistError;
  }
  if (res.status === 429) {
    throw { kind: 'rate_limited', message: 'AI 调用过于频繁，请稍后再试。' } as AssistError;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.result) {
    throw { kind: 'error', message: data.reason ?? data.error ?? 'AI 生成失败。' } as AssistError;
  }
  return data.result as AssistResult;
}
