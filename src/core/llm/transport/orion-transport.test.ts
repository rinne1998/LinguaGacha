import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { OrionTransport } from "./orion-transport";
import type { ProviderClientPoolRequest, ProviderClientResolver } from "./transport-types";

describe("OrionTransport", () => {
  it("读取非流式 chat completion 的正文、思考和 token 用量", async () => {
    const captured_requests: ProviderClientPoolRequest[] = [];
    const transport = new OrionTransport(
      create_pool(captured_requests, {
        choices: [
          {
            message: {
              content: ' {"1":"你好"} ',
              reasoning_content: " 推理 ",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      }),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toEqual({
      response_think: "推理",
      response_result: '{"1":"你好"}',
      input_tokens: 3,
      output_tokens: 5,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    });
    expect(captured_requests[0]).toMatchObject({
      provider: "orion",
      api_key: "key",
      base_url: "http://127.0.0.1:8080/v1",
    });
  });

  it("长度截断时清空正文并返回可展示错误", async () => {
    const transport = new OrionTransport(
      create_pool([], {
        choices: [{ message: { content: "半截译文" }, finish_reason: "length" }],
        usage: { prompt_tokens: 2, completion_tokens: 4 },
      }),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      input_tokens: 2,
      output_tokens: 4,
      error: "供应商返回长度截断。",
    });
  });

  it("缺少正文时返回失败原因而不是空成功", async () => {
    const transport = new OrionTransport(create_pool([], { choices: [{ message: {} }] }));

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      error: "供应商未返回正文。",
    });
  });
});

function create_pool(
  captured_requests: ProviderClientPoolRequest[],
  response: unknown,
): ProviderClientResolver {
  return {
    get_client: <T>(request: ProviderClientPoolRequest) => {
      captured_requests.push(request);
      return {
        chat: {
          completions: {
            create: async () => response,
          },
        },
      } as T;
    },
  };
}

function create_policy(overrides: Partial<ResolvedRequestPolicy> = {}): ResolvedRequestPolicy {
  return {
    provider: "orion",
    api_format: "Orion",
    base_url: "http://127.0.0.1:8080/v1",
    model_id: "Orion-Qwen3-1.7B-SFT-v2605",
    headers: {},
    api_keys: ["key"],
    messages: [{ role: "user", content: "こんにちは" }],
    payload: {
      model: "Orion-Qwen3-1.7B-SFT-v2605",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: false,
    },
    timeout_ms: 120_000,
    response_mode: "orion-jsonl",
    diagnostics: {},
    ...overrides,
  };
}