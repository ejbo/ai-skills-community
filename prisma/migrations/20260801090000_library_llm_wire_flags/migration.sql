-- Wire flags for a self-hosted OpenAI-compatible LLM (vLLM/SGLang).
-- `llmDisableThinking` makes the app send chat_template_kwargs.enable_thinking=false
-- so a reasoning model (GLM / Qwen-thinking) stops spending its whole token budget
-- inside <think> before emitting the JSON the 知识库 indexer needs.
-- Both default false: api.openai.com rejects unknown request fields with a 400.
ALTER TABLE "LibrarySetting" ADD COLUMN "llmDisableThinking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LibrarySetting" ADD COLUMN "llmJsonMode" BOOLEAN NOT NULL DEFAULT false;
