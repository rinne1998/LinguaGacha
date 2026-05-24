import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "../llm-client-policy";
import { RequestValidationError } from "../../../shared/error";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

const ORION_CHAT_COMPLETIONS_SUFFIX_PATTERN = /\/chat\/completions$/iu;

/**
 * Orion 走 OpenAI-compatible chat completions，但本机部署常见 host 前缀需要补齐 /v1。
 */
export function normalize_orion_sdk_base_url(url: string): string {
  const trimmed = url.trim().replace(/\/+$/u, "");
  const without_endpoint = trimmed.replace(ORION_CHAT_COMPLETIONS_SUFFIX_PATTERN, "");
  if (without_endpoint === "") {
    return "";
  }
  try {
    const parsed = new URL(without_endpoint);
    return parsed.pathname === "/" ? `${without_endpoint}/v1` : without_endpoint;
  } catch {
    return without_endpoint;
  }
}

/**
 * Orion SFT 模型使用非流式 chat completions，响应正文保持 JSONL 原文。
 */
export function build_orion_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: snapshot.model_id,
    messages: normalize_orion_chat_messages(messages),
    stream: false,
  };
  patch_temperature(payload, snapshot, { allow_thinking_temperature: true });
  patch_generation_fields(payload, snapshot.generation, {
    top_p: "top_p",
    presence_penalty: "presence_penalty",
    frequency_penalty: "frequency_penalty",
  });
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) {
    payload["max_tokens"] = max_tokens;
  }
  Object.assign(payload, snapshot.extra_body);
  return payload;
}

/**
 * Orion 训练格式只需要单个 user prompt；空请求在协议边界直接阻断。
 */
function normalize_orion_chat_messages(
  messages: LLMMessage[],
): Array<{ role: string; content: string }> {
  const content = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  if (content === "") {
    throw new RequestValidationError({
      public_details: { field: "messages" },
      diagnostic_context: { provider_policy: "orion", reason: "empty_messages" },
    });
  }
  return [{ role: "user", content }];
}