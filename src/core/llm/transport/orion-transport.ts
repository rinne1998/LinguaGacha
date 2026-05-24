import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import type {
  ProviderClientResolver,
  RequestTransport,
} from "./transport-types";

/**
 * OrionTransport 使用 OpenAI-compatible SDK client，但读取非流式 message.content 响应。
 */
export class OrionTransport implements RequestTransport {
  /**
   * pool 是 SDK client 的唯一来源，Orion 只改变响应读取方式。
   */
  public constructor(private readonly pool: ProviderClientResolver) {}

  public async send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult> {
    const client = this.pool.get_client<{ chat: { completions: { create: Function } } }>({
      provider: policy.provider,
      api_format: policy.api_format,
      base_url: policy.base_url,
      api_key: policy.api_keys[0] ?? "no_key_required",
      timeout_ms: policy.timeout_ms,
      headers: policy.headers,
    });
    const response = await client.chat.completions.create(policy.payload, { signal });
    return this.collect_completion(response);
  }

  /**
   * OrionTranslator 读取 choices[0].message.content；这里同步归一 usage 与截断错误。
   */
  private collect_completion(response: unknown): LLMRequestResult {
    const record = this.as_record(response);
    const choices = Array.isArray(record["choices"]) ? record["choices"] : [];
    const first_choice = this.as_record(choices[0]);
    const message = this.as_record(first_choice["message"]);
    const response_result = this.read_text(message["content"]);
    const response_think = this.read_text(message["reasoning_content"] ?? message["reasoning"]);
    const usage = this.as_record(record["usage"]);
    const input_tokens = this.read_number(usage["prompt_tokens"] ?? usage["input_tokens"], 0);
    const output_tokens = this.read_number(
      usage["completion_tokens"] ?? usage["output_tokens"],
      0,
    );
    const finish_reason = this.read_text(first_choice["finish_reason"]);
    if (finish_reason === "length") {
      return this.empty_result({ input_tokens, output_tokens, error: "供应商返回长度截断。" });
    }
    if (finish_reason === "tool_calls") {
      return this.empty_result({
        input_tokens,
        output_tokens,
        error: "供应商返回工具调用，当前任务不支持。",
      });
    }
    if (response_result.trim() === "") {
      return this.empty_result({ input_tokens, output_tokens, error: "供应商未返回正文。" });
    }
    if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
      return this.empty_result({ input_tokens, output_tokens, degraded: true });
    }
    return {
      response_think: response_think.trim(),
      response_result: response_result.trim(),
      input_tokens,
      output_tokens,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    };
  }

  private empty_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
    return {
      response_think: "",
      response_result: "",
      input_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
      ...overrides,
    };
  }

  private as_record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private read_text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}