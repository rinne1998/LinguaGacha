import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import { build_orion_payload, normalize_orion_sdk_base_url } from "./orion-policy";

describe("orion-policy", () => {
  it("Orion baseUrl 兼容完整 endpoint、host 前缀和接口根路径", () => {
    expect(normalize_orion_sdk_base_url("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(normalize_orion_sdk_base_url("http://127.0.0.1:8080/v1/chat/completions/")).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(normalize_orion_sdk_base_url("https://ark.example/api/v3")).toBe(
      "https://ark.example/api/v3",
    );
  });

  it("构造 Orion 非流式 chat completions payload 并只保留 user prompt", () => {
    const payload = build_orion_payload(
      create_snapshot({
        generation: {
          temperature_custom_enable: true,
          temperature: 0.8,
          top_p_custom_enable: true,
          top_p: 0.9,
        },
        extra_body: { top_k: 20 },
      }),
      [
        { role: "system", content: " 系统约束 " },
        { role: "user", content: " こんにちは " },
      ],
    );

    expect(payload).toMatchObject({
      model: "Orion-Qwen3-1.7B-SFT-v2605",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: false,
      max_tokens: 3200,
      temperature: 0.8,
      top_p: 0.9,
      top_k: 20,
    });
  });

  it("空 Orion user prompt 在协议边界直接阻断", () => {
    expect(() =>
      build_orion_payload(create_snapshot(), [{ role: "system", content: "only system" }]),
    ).toThrow("request.validation_failed");
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "orion",
    api_format: "Orion",
    api_keys: ["key"],
    base_url: "http://127.0.0.1:8080/v1",
    model_id: "Orion-Qwen3-1.7B-SFT-v2605",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 3200,
    thinking_level: "OFF",
    ...overrides,
  };
}