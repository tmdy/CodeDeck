import type {
  ProfileHealthCheckpoint,
  ProfileHealthReasonCode,
  ProfileHealthState,
  ProfileHealthStatus,
  ProfileHealthTarget,
} from "./types.js";

export const PROFILE_HEALTH_FIXED_RULES = [
  "你正在和用户共同进行一个长期、没有终点的‘微型旅途札记’。",
  "当收到‘继续’时，请继续上一条札记。",
  "规则：",
  "1. 每一轮只写一条很短的旅途札记，大约 20～50 个中文字。",
  "2. 每条札记都有递增序号。上一条是 N，本条必须是 N+1。",
  "3. 每条札记都会留下一个‘下一词’。",
  "4. 下一轮札记正文必须自然地使用上一轮留下的‘下一词’。",
  "5. 本轮再选择一个新的具体名词作为下一轮的‘下一词’。",
  "6. 新的‘下一词’不要与上一轮相同。",
  "7. 故事不需要走向结局，可以不断经过新的街道、城市、人物、天气和小事件。",
  "8. 不要解释这些规则，不要告诉用户你在检查状态，也不要询问是否继续。",
  "9. 正文之后空一行，再以‘〔旅记 N｜下一词：词语〕’记录当前状态。",
  "10. 除札记正文和状态行外，不要输出 Markdown、代码块或其他内容。",
].join("\n");

export const INITIAL_PROFILE_HEALTH_CHECKPOINT: ProfileHealthCheckpoint = {
  sequence: 0,
  carry_word: "钟声",
  assistant_text: "海边旧车站仍在等待第一班列车。\n\n〔旅记 0｜下一词：钟声〕",
};

export interface ParsedProfileHealthReply {
  sequence: number;
  body: string;
  carryWord: string;
}

export interface ProfileHealthValidationResult {
  valid: boolean;
  message: string;
  checkpoint?: ProfileHealthCheckpoint;
}

export interface ProfileHealthCliFailure {
  status: ProfileHealthStatus;
  reasonCode: ProfileHealthReasonCode;
  message: string;
}

export function buildProfileHealthPrompt(previous?: ProfileHealthCheckpoint): string {
  if (!previous) {
    return [
      PROFILE_HEALTH_FIXED_RULES,
      "",
      "初始化状态：",
      "序号：0",
      "地点：海边旧车站",
      "下一词：钟声",
      "",
      "本轮用户输入：继续",
    ].join("\n");
  }
  return [
    PROFILE_HEALTH_FIXED_RULES,
    "",
    "上一轮 assistant 完整回复：",
    previous.assistant_text,
    "",
    "本轮用户输入：继续",
  ].join("\n");
}

export function parseProfileHealthReply(text: string): ParsedProfileHealthReply | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 2) {
    return null;
  }
  const [body, marker] = lines;
  const markerMatch = marker.match(/^〔旅记\s*(\d+)｜下一词：([^〕\r\n]+)〕$/);
  if (!markerMatch) {
    return null;
  }
  const carryWord = markerMatch[2].trim();
  if (!body || !carryWord) {
    return null;
  }
  return {
    sequence: Number.parseInt(markerMatch[1], 10),
    body,
    carryWord,
  };
}

export function validateProfileHealthReply(
  assistantText: string,
  previous: ProfileHealthCheckpoint = INITIAL_PROFILE_HEALTH_CHECKPOINT,
): ProfileHealthValidationResult {
  const parsed = parseProfileHealthReply(assistantText);
  if (!parsed) {
    return { valid: false, message: "响应格式不符合微型旅途札记约定" };
  }
  if (parsed.sequence !== previous.sequence + 1) {
    return { valid: false, message: `响应序号应为 ${previous.sequence + 1}` };
  }
  if (!parsed.body.includes(previous.carry_word)) {
    return { valid: false, message: "响应正文未承接上一轮关键词" };
  }
  if (!parsed.carryWord || parsed.carryWord.toLocaleLowerCase() === previous.carry_word.toLocaleLowerCase()) {
    return { valid: false, message: "新承接词缺失或未发生变化" };
  }
  return {
    valid: true,
    message: "",
    checkpoint: {
      sequence: parsed.sequence,
      carry_word: parsed.carryWord,
      assistant_text: assistantText.trim().slice(0, 4_000),
    },
  };
}

export function createRunningProfileHealthState(
  target: ProfileHealthTarget,
  previous?: ProfileHealthState,
): ProfileHealthState {
  return {
    target: { ...target },
    status: previous?.status ?? "unknown",
    reason_code: previous?.reason_code ?? "not_checked",
    source: "active",
    running: true,
    checked_at: previous?.checked_at ?? "",
    verified_at: previous?.verified_at ?? "",
    consecutive_successes: previous?.consecutive_successes ?? 0,
    last_failure: previous?.last_failure ?? "",
    ...(previous?.latency_ms === undefined ? {} : { latency_ms: previous.latency_ms }),
    ...(previous?.checkpoint ? { checkpoint: { ...previous.checkpoint } } : {}),
  };
}

export function createCompletedProfileHealthState(options: {
  target: ProfileHealthTarget;
  previous?: ProfileHealthState;
  assistantText: string;
  checkedAt: string;
  latencyMs: number;
}): ProfileHealthState {
  const validation = validateProfileHealthReply(
    options.assistantText,
    options.previous?.checkpoint ?? INITIAL_PROFILE_HEALTH_CHECKPOINT,
  );
  if (!validation.valid || !validation.checkpoint) {
    return createFailedProfileHealthState({
      target: options.target,
      previous: options.previous,
      status: "degraded",
      reasonCode: "continuity_invalid",
      message: validation.message,
      checkedAt: options.checkedAt,
      latencyMs: options.latencyMs,
    });
  }
  return {
    target: { ...options.target },
    status: "available",
    reason_code: "ok",
    source: "active",
    running: false,
    latency_ms: options.latencyMs,
    checked_at: options.checkedAt,
    verified_at: options.checkedAt,
    consecutive_successes: (options.previous?.consecutive_successes ?? 0) + 1,
    last_failure: "",
    checkpoint: validation.checkpoint,
  };
}

export function createFailedProfileHealthState(options: {
  target: ProfileHealthTarget;
  previous?: ProfileHealthState;
  status: ProfileHealthStatus;
  reasonCode: ProfileHealthReasonCode;
  message: string;
  checkedAt: string;
  latencyMs: number;
}): ProfileHealthState {
  return {
    target: { ...options.target },
    status: options.status,
    reason_code: options.reasonCode,
    source: "active",
    running: false,
    latency_ms: options.latencyMs,
    checked_at: options.checkedAt,
    verified_at: options.previous?.verified_at ?? "",
    consecutive_successes: 0,
    last_failure: sanitizeProfileHealthFailureMessage(options.message),
    ...(options.previous?.checkpoint ? { checkpoint: { ...options.previous.checkpoint } } : {}),
  };
}

export function classifyProfileHealthCliFailure(
  evidence: unknown,
  options: { timedOut?: boolean; secrets?: string[] } = {},
): ProfileHealthCliFailure {
  const message = sanitizeProfileHealthFailureMessage(
    evidence instanceof Error ? evidence.message : String(evidence ?? ""),
    options.secrets,
  );
  if (options.timedOut) {
    return { status: "network_error", reasonCode: "timeout", message: message || "健康检测超时" };
  }
  if (/\b429\b|rate[ -]?limit|too many requests|限流|请求过多/i.test(message)) {
    return { status: "rate_limited", reasonCode: "rate_limited", message: message || "CLI 报告请求限流" };
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden|invalid (?:api )?key|authentication|鉴权|认证失败|密钥无效/i.test(message)) {
    return { status: "auth_failed", reasonCode: "auth_failed", message: message || "CLI 报告鉴权失败" };
  }
  if (/model.{0,40}(?:not found|unavailable|unsupported|does not exist)|模型.{0,20}(?:不存在|不可用|不支持)/i.test(message)) {
    return { status: "model_unavailable", reasonCode: "provider_error", message: message || "CLI 报告模型不可用" };
  }
  if (/\b5\d{2}\b|bad gateway|service unavailable|gateway timeout|网关错误|服务不可用|网关超时/i.test(message)) {
    return { status: "model_unavailable", reasonCode: "provider_error", message: message || "CLI 报告 Provider 服务不可用" };
  }
  return {
    status: "network_error",
    reasonCode: "network_error",
    message: message || "健康 CLI 会话异常结束",
  };
}

export function createPassiveProfileHealthState(
  target: ProfileHealthTarget,
  previous?: ProfileHealthState,
  verifiedAt: string = new Date().toISOString(),
): ProfileHealthState {
  return {
    target: { ...target },
    status: "available",
    reason_code: "ok",
    source: "passive",
    running: false,
    checked_at: verifiedAt,
    verified_at: verifiedAt,
    consecutive_successes: (previous?.consecutive_successes ?? 0) + 1,
    last_failure: "",
    ...(previous?.checkpoint ? { checkpoint: { ...previous.checkpoint } } : {}),
  };
}

export function sanitizeProfileHealthFailureMessage(value: string, secrets: string[] = []): string {
  const redactedSecrets = secrets.reduce((current, secret) => {
    const normalized = secret.trim();
    return normalized ? current.replaceAll(normalized, "[REDACTED]") : current;
  }, value);
  return redactedSecrets
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{8,}\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
