import { describe, expect, it } from "vitest";
import {
  INITIAL_PROFILE_HEALTH_CHECKPOINT,
  PROFILE_HEALTH_FIXED_RULES,
  buildProfileHealthPrompt,
  classifyProfileHealthCliFailure,
  createCompletedProfileHealthState,
  createPassiveProfileHealthState,
  sanitizeProfileHealthFailureMessage,
  validateProfileHealthReply,
} from "../../profile-health/service.js";
import type { ProfileHealthTarget } from "../../profile-health/types.js";

const target: ProfileHealthTarget = {
  provider: "codex",
  profile_key: "codex::Relay",
  channel_id: "default",
  base_url: "https://relay.example/v1",
  model_id: "gpt-test",
};

describe("profile health service", () => {
  it("builds a complete Chinese micro-journey initialization prompt", () => {
    const prompt = buildProfileHealthPrompt();

    expect(prompt).toContain(PROFILE_HEALTH_FIXED_RULES);
    expect(prompt).toContain("微型旅途札记");
    expect(prompt).toContain("序号：0");
    expect(prompt).toContain("地点：海边旧车站");
    expect(prompt).toContain("下一词：钟声");
    expect(prompt).toContain("本轮用户输入：继续");
    expect(prompt).not.toContain("上一轮 assistant 完整回复：");
  });

  it("uses only fixed rules, the previous full reply, and literal continue later", () => {
    const previous = {
      sequence: 4,
      carry_word: "星河",
      assistant_text: "列车沿着星河倒影驶入山谷。\n\n〔旅记 4｜下一词：星河〕",
    };
    const prompt = buildProfileHealthPrompt(previous);

    expect(prompt).toBe([
      PROFILE_HEALTH_FIXED_RULES,
      "",
      "上一轮 assistant 完整回复：",
      previous.assistant_text,
      "",
      "本轮用户输入：继续",
    ].join("\n"));
    expect(prompt).not.toContain(INITIAL_PROFILE_HEALTH_CHECKPOINT.assistant_text);
  });

  it("validates sequence, previous carry word, and a changed carry word", () => {
    expect(validateProfileHealthReply(
      "远处的钟声穿过旧站台，慢车沿海岸驶向晨光。\n\n〔旅记 1｜下一词：车窗〕",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: true });
    expect(validateProfileHealthReply(
      "远处的钟声穿过旧站台。\n\n〔旅记 2｜下一词：车窗〕",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "响应序号应为 1" });
    expect(validateProfileHealthReply(
      "慢车沿着海岸驶向晨光。\n\n〔旅记 1｜下一词：车窗〕",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "响应正文未承接上一轮关键词" });
    expect(validateProfileHealthReply(
      "远处的钟声仍在旧站台回荡。\n\n〔旅记 1｜下一词：钟声〕",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "新承接词缺失或未发生变化" });
    expect(validateProfileHealthReply(
      "说明如下：\n\n远处的钟声仍在旧站台回荡。",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "响应格式不符合微型旅途札记约定" });
    expect(validateProfileHealthReply(
      "下面是续写：\n远处的钟声仍在旧站台回荡。\n\n〔旅记 1｜下一词：车窗〕",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "响应格式不符合微型旅途札记约定" });
    expect(validateProfileHealthReply(
      "```text\n远处的钟声仍在旧站台回荡。\n\n〔旅记 1｜下一词：车窗〕\n```",
      INITIAL_PROFILE_HEALTH_CHECKPOINT,
    )).toMatchObject({ valid: false, message: "响应格式不符合微型旅途札记约定" });
  });

  it("creates available and degraded states from completed CLI replies", () => {
    expect(createCompletedProfileHealthState({
      target,
      assistantText: "远处的钟声穿过旧站台，慢车沿海岸驶向晨光。\n\n〔旅记 1｜下一词：车窗〕",
      checkedAt: "2026-08-17T09:00:00.000Z",
      latencyMs: 320,
    })).toMatchObject({
      status: "available",
      reason_code: "ok",
      latency_ms: 320,
      consecutive_successes: 1,
      checkpoint: { sequence: 1, carry_word: "车窗" },
    });

    expect(createCompletedProfileHealthState({
      target,
      assistantText: "not machine readable",
      checkedAt: "2026-08-17T09:00:00.000Z",
      latencyMs: 500,
    })).toMatchObject({
      status: "degraded",
      reason_code: "continuity_invalid",
      consecutive_successes: 0,
    });
  });

  it("classifies CLI evidence without depending on Provider HTTP responses", () => {
    expect(classifyProfileHealthCliFailure("Error 429: rate limit exceeded")).toMatchObject({
      status: "rate_limited",
      reasonCode: "rate_limited",
    });
    expect(classifyProfileHealthCliFailure("401 Unauthorized: invalid API key")).toMatchObject({
      status: "auth_failed",
      reasonCode: "auth_failed",
    });
    expect(classifyProfileHealthCliFailure("The requested model was not found")).toMatchObject({
      status: "model_unavailable",
      reasonCode: "provider_error",
    });
    expect(classifyProfileHealthCliFailure("502 Bad Gateway")).toMatchObject({
      status: "model_unavailable",
      reasonCode: "provider_error",
    });
    expect(classifyProfileHealthCliFailure("session timed out", { timedOut: true })).toMatchObject({
      status: "network_error",
      reasonCode: "timeout",
    });
    expect(classifyProfileHealthCliFailure("process exited with code 1")).toMatchObject({
      status: "network_error",
      reasonCode: "network_error",
    });
  });

  it("bounds terminal failure text and redacts URL credentials and token-like values", () => {
    const result = sanitizeProfileHealthFailureMessage(
      "failed https://probe-user:probe-password@relay.example/v1 with sk-secretvalue123456 and custom-secret",
      ["custom-secret"],
    );

    expect(result).toContain("https://[REDACTED]@relay.example/v1");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("probe-user");
    expect(result).not.toContain("probe-password");
    expect(result).not.toContain("secretvalue123456");
    expect(result).not.toContain("custom-secret");
  });

  it("maps an authoritative monitored turn to passive availability without advancing the checkpoint", () => {
    const previous = {
      target,
      status: "degraded" as const,
      reason_code: "continuity_invalid" as const,
      source: "active" as const,
      running: false,
      checked_at: "2026-08-17T08:00:00.000Z",
      verified_at: "",
      consecutive_successes: 0,
      last_failure: "bad format",
      checkpoint: {
        sequence: 3,
        carry_word: "晨光",
        assistant_text: "星河在晨光里慢慢隐去。\n\n〔旅记 3｜下一词：晨光〕",
      },
    };
    const passive = createPassiveProfileHealthState(target, previous, "2026-08-17T09:00:00.000Z");

    expect(passive).toMatchObject({
      status: "available",
      source: "passive",
      checkpoint: previous.checkpoint,
    });
  });
});
