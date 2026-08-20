import type { Profile } from "../profile/types.js";
import type { BalanceCheckState } from "../balance/types.js";
import type { CheckinResult } from "../checkin/types.js";
import type {
  CustomBalanceRule,
  CustomCheckinRule,
  CustomDomRoot,
} from "./custom-compatibility.js";
import {
  classifyCustomCheckinResult,
  mapCustomBalanceItem,
} from "./custom-compatibility.js";

export interface CustomCompatibilityRequestTransport {
  fetch: typeof fetch;
  headers?: Readonly<Record<string, string>>;
  credentials?: "include" | "omit" | "same-origin";
}

export interface CustomCompatibilityPageTransport {
  readBalance(rule: CustomBalanceRule, timeoutMs: number): Promise<CustomDomRoot>;
  runCheckin(
    rule: CustomCheckinRule,
    timeoutMs: number,
  ): Promise<{ root: CustomDomRoot; challengeDetected: boolean }>;
}

export interface CustomCompatibilityExecutionOptions {
  request: CustomCompatibilityRequestTransport;
  page?: CustomCompatibilityPageTransport;
}

interface CustomResponse {
  status: number;
  bodyText: string;
  payload: unknown;
  error: string;
}

export class CustomCompatibilityExecutor {
  async queryBalance(
    profile: Pick<Profile, "provider" | "name" | "url">,
    rule: CustomBalanceRule,
    timeoutMs: number,
    options: CustomCompatibilityExecutionOptions,
  ): Promise<BalanceCheckState> {
    const context = {
      provider: profile.provider,
      profile_name: profile.name,
      base_url: profile.url.trim().replace(/\/+$/, ""),
    };
    if (rule.mode === "page") {
      if (!options.page) {
        return balanceFailure(context, rule.target_url, "当前账号无法执行自定义网页余额规则");
      }
      try {
        const root = await options.page.readBalance(rule, timeoutMs);
        const mapped = mapCustomBalanceItem({ kind: "dom", root }, rule);
        return mapped.ok
          ? balanceSuccess(context, rule.target_url, mapped.item)
          : balanceFailure(context, rule.target_url, mapped.error);
      } catch (error) {
        return balanceFailure(context, rule.target_url, describeExecutionError(error, "自定义余额页面读取失败"));
      }
    }

    const response = await requestCustomTarget(rule, timeoutMs, options.request);
    if (response.error) {
      return balanceFailure(context, rule.target_url, response.error);
    }
    if (isRedirectStatus(response.status)) {
      return balanceFailure(context, rule.target_url, "自定义余额目标发生重定向，已按安全策略阻止");
    }
    if (response.status === 401 || response.status === 403) {
      return balanceFailure(context, rule.target_url, "自定义余额规则鉴权失败，请检查凭据转发授权");
    }
    if (response.status < 200 || response.status >= 300) {
      return balanceFailure(context, rule.target_url, `自定义余额请求失败（HTTP ${response.status}）`);
    }
    if (response.payload === null) {
      return balanceFailure(context, rule.target_url, "自定义余额 API 未返回有效 JSON");
    }
    const mapped = mapCustomBalanceItem({ kind: "json", value: response.payload }, rule);
    return mapped.ok
      ? balanceSuccess(context, rule.target_url, mapped.item)
      : balanceFailure(context, rule.target_url, mapped.error);
  }

  async checkin(
    rule: CustomCheckinRule,
    timeoutMs: number,
    options: CustomCompatibilityExecutionOptions,
  ): Promise<CheckinResult> {
    if (rule.mode === "page") {
      if (!options.page) {
        return checkinFailure(rule.target_url, "当前账号无法执行自定义网页签到规则");
      }
      try {
        const pageResult = await options.page.runCheckin(rule, timeoutMs);
        return classifyCustomCheckinResult(
          rule,
          { kind: "dom", root: pageResult.root },
          { bodyText: pageResult.challengeDetected ? "captcha challenge" : "" },
        );
      } catch (error) {
        return checkinFailure(rule.target_url, describeExecutionError(error, "自定义签到页面执行失败"));
      }
    }

    const response = await requestCustomTarget(rule, timeoutMs, options.request);
    if (response.error) {
      return checkinFailure(rule.target_url, response.error, "network_error");
    }
    if (isRedirectStatus(response.status)) {
      return checkinFailure(
        rule.target_url,
        "自定义签到目标发生重定向，已按安全策略阻止",
        "auth_not_logged_in",
      );
    }
    return classifyCustomCheckinResult(
      rule,
      { kind: "json", value: response.payload },
      { bodyText: response.bodyText, httpStatus: response.status },
    );
  }
}

async function requestCustomTarget(
  rule: CustomBalanceRule | CustomCheckinRule,
  timeoutMs: number,
  transport: CustomCompatibilityRequestTransport,
): Promise<CustomResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const method = rule.method ?? ("success_path" in rule ? "GET" : "POST");
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      ...transport.headers,
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }
    const response = await transport.fetch(rule.target_url, {
      method,
      headers,
      ...(method === "POST" ? { body: rule.request_body ?? "{}" } : {}),
      ...(transport.credentials ? { credentials: transport.credentials } : {}),
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    let bodyText = "";
    try {
      bodyText = (await response.text()).trim();
    } catch {
      bodyText = "";
    }
    let payload: unknown = null;
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = null;
      }
    }
    return { status: response.status, bodyText, payload, error: "" };
  } catch (error) {
    return {
      status: 0,
      bodyText: "",
      payload: null,
      error: error instanceof Error && error.name === "AbortError"
        ? "自定义规则请求超时"
        : describeExecutionError(error, "自定义规则网络请求失败"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function balanceSuccess(
  context: Pick<BalanceCheckState, "provider" | "profile_name" | "base_url">,
  endpoint: string,
  item: BalanceCheckState["items"][number],
): BalanceCheckState {
  return {
    ...context,
    running: false,
    supported: true,
    success: true,
    message: "余额已更新（自定义规则）",
    items: [item],
    endpoint,
    finished_at_display: "",
  };
}

function balanceFailure(
  context: Pick<BalanceCheckState, "provider" | "profile_name" | "base_url">,
  endpoint: string,
  message: string,
): BalanceCheckState {
  return {
    ...context,
    running: false,
    supported: true,
    success: false,
    message,
    items: [],
    endpoint,
    finished_at_display: "",
  };
}

function checkinFailure(
  endpoint: string,
  message: string,
  errorCode: CheckinResult["error_code"] = "business_rejected",
): CheckinResult {
  return {
    status: "failed",
    success: false,
    message,
    endpoint,
    error_code: errorCode,
  };
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function describeExecutionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}
