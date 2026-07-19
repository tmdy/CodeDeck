import type { SiteBalanceSession } from "../balance/site-balance-sessions.js";
import type {
  CheckinErrorCode,
  CheckinResult,
  CheckinTrigger,
  CheckinVerificationCookieMode,
} from "../checkin/types.js";
import {
  buildManagementAuthorizationCandidates,
  buildManagementCookieCandidates,
  type ManagementAuthorizationMode,
  type ManagementCookieMode,
} from "./management-auth.js";

interface CheckinResponse {
  status: number;
  payload: unknown;
  bodyText: string;
  durationMs: number;
  responseKind: CheckinResponseKind;
}

interface CheckinRequestOptions {
  method?: "GET" | "POST";
  body?: string;
}

type CheckinResponseKind = "json" | "html" | "text" | "empty" | "network_error";
type CheckinDiagnosticMessageCode = CheckinErrorCode | "success" | "already_checked" | "user_id_discovered";
type CheckinDiagnosticStage =
  | "checkin_status"
  | "checkin_direct"
  | "sign_in_cookie"
  | "checkin_cookie"
  | "discover_user"
  | "checkin_discovered_user";
type CheckinUserIdSource = "saved" | "discovered" | "none";

interface CheckinAuthTransport {
  headers: Record<string, string>;
  authorizationMode: ManagementAuthorizationMode | "none";
  cookieMode: ManagementCookieMode | "none";
}

interface CheckinAttemptExecution {
  response: CheckinResponse;
  result: CheckinResult;
}

interface CheckinStatusInspection {
  authenticated: boolean;
  endpointMissing: boolean;
  diagnosticResult: CheckinResult;
  terminalResult?: CheckinResult;
}

interface ResolvedStatusAttempt {
  inspection: CheckinStatusInspection;
  response: CheckinResponse;
  userId: string;
  userIdSource: CheckinUserIdSource;
}

export interface CheckinDiagnosticAttempt {
  event: "auth_attempt";
  run_id: string;
  trigger: CheckinTrigger;
  base_url_host: string;
  stage: CheckinDiagnosticStage;
  authorization_mode: ManagementAuthorizationMode | "none";
  cookie_mode: ManagementCookieMode | "none";
  user_id_source: CheckinUserIdSource;
  method: "GET" | "POST";
  endpoint_path: string;
  http_status: number;
  payload_success: boolean;
  response_kind: CheckinResponseKind;
  message_code: CheckinDiagnosticMessageCode;
  message_preview?: string;
  duration_ms: number;
}

export interface CheckinDiagnosticsOptions {
  runId: string;
  trigger: CheckinTrigger;
  onDiagnostic?: (event: CheckinDiagnosticAttempt) => void;
}

const ALREADY_CHECKED_PATTERN = /今天?已(?:经)?签到|今日已(?:经)?签到|已经签到|已签到|already\s+(?:checked|signed|check(?:ed)?\s*in)|already\s+sign(?:ed)?\s+in|checked[_\s-]*in[_\s-]*today/i;
const MANUAL_REQUIRED_PATTERN = /turnstile|cloudflare|captcha|challenge|人机|验证码|校验/i;
const USER_ID_MISSING_PATTERN = /missing[^\n]*(?:user[-_ ]?id|new-api-user)|(?:user[-_ ]?id|new-api-user)[^\n]*(?:missing|required)|用户\s*(?:id|ID)[^\n]*(?:缺少|必填|需要)|未提供[^\n]*用户/i;
const USER_ID_MISMATCH_PATTERN = /(?:user[-_ ]?id|new-api-user)[^\n]*(?:mismatch|does not match|incorrect)|用户\s*(?:id|ID)[^\n]*(?:不匹配|不一致|错误)/i;
const ACCESS_TOKEN_INVALID_PATTERN = /invalid\s+(?:access\s+)?token|access token[^\n]*(?:invalid|expired)|access token\s*无效|令牌[^\n]*(?:失效|过期)/i;
const AUTH_NOT_LOGGED_IN_PATTERN = /unauthorized|forbidden|not logged|未登录|鉴权|无权限|no access token provided|未提供[^\n]*access token|登录[^\n]*过期/i;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 160;

export class CheckinService {
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async checkin(
    session: SiteBalanceSession,
    timeoutMs: number = 10_000,
    diagnostics?: CheckinDiagnosticsOptions,
  ): Promise<CheckinResult> {
    const baseUrl = session.base_url.trim().replace(/\/+$/, "");
    const accessToken = session.access_token.trim();
    const savedUserId = session.user_id.trim() || null;
    const checkinEndpoint = `${baseUrl}/api/user/checkin`;
    const failures: CheckinResult[] = [];
    const knownUserIds = new Set<string>(savedUserId ? [savedUserId] : []);

    const sensitiveValues = (
      transport?: CheckinAuthTransport,
      userId?: string | null,
    ): string[] => [
      accessToken,
      ...Object.values(transport?.headers ?? {}),
      ...knownUserIds,
      userId ?? "",
    ];

    const finish = (result: CheckinResult): CheckinResult => {
      const normalized = normalizeFinalFailure(result);
      const sanitizedMessage = sanitizeDiagnosticMessage(
        normalized.message,
        sensitiveValues(),
      ) || defaultFailureMessage(0, normalized.error_code ?? "unknown_failure");
      return redactResult({
        ...normalized,
        message: sanitizedMessage,
        ...(diagnostics?.runId ? { diagnostic_run_id: diagnostics.runId } : {}),
      }, accessToken);
    };

    if (isKnownUnsupportedCheckinPlatform(baseUrl)) {
      return finish(unsupportedResult(
        `${baseUrl}/api/user/checkin`,
        baseUrl,
        "该类型站点不提供用户签到接口",
      ));
    }

    if (!baseUrl || !accessToken) {
      return finish(failedResult(
        checkinEndpoint,
        "后台账号缺少站点地址或 Access Token / Session",
        "access_token_invalid",
      ));
    }

    if (isVoApiV2BaseUrl(baseUrl)) {
      const result = await this.tryVoApiV2Checkin(baseUrl, accessToken, timeoutMs);
      return finish(result ?? unsupportedResult(
        `${baseUrl}/api/check_in`,
        baseUrl,
        "未识别到可用的 VoAPI v2 签到接口",
      ));
    }

    const emitAttemptDiagnostic = (
      response: CheckinResponse,
      result: CheckinResult,
      endpointPath: string,
      transport: CheckinAuthTransport,
      stage: CheckinDiagnosticStage,
      userId: string | null,
      userIdSource: CheckinUserIdSource,
      method: "GET" | "POST",
      messageCode?: CheckinDiagnosticMessageCode,
    ): void => {
      const messagePreview = response.responseKind === "json"
        ? sanitizeDiagnosticMessage(
          extractMessage(response.payload),
          sensitiveValues(transport, userId),
        )
        : "";
      emitDiagnostic(diagnostics, {
        event: "auth_attempt",
        run_id: diagnostics?.runId ?? "",
        trigger: diagnostics?.trigger ?? "manual",
        base_url_host: safeUrlHost(baseUrl),
        stage,
        authorization_mode: transport.authorizationMode,
        cookie_mode: transport.cookieMode,
        user_id_source: userIdSource,
        method,
        endpoint_path: endpointPath,
        http_status: response.status,
        payload_success: payloadSignalsSuccess(response.payload),
        response_kind: response.responseKind,
        message_code: messageCode ?? diagnosticMessageCode(result),
        ...(messagePreview ? { message_preview: messagePreview } : {}),
        duration_ms: response.durationMs,
      });
    };

    const runActionAttempt = async (
      endpointPath: string,
      transport: CheckinAuthTransport,
      stage: CheckinDiagnosticStage,
      userId: string | null,
      userIdSource: CheckinUserIdSource,
      method: "GET" | "POST" = "POST",
    ): Promise<CheckinAttemptExecution> => {
      const endpoint = `${baseUrl}${endpointPath}`;
      const response = await this.request(
        endpoint,
        timeoutMs,
        {
          ...transport.headers,
          ...(userId ? buildUserIdHeaders(userId) : {}),
        },
        { method },
      );
      const classifiedResult = method === "GET" && payloadLooksLikeCheckinStatus(response.payload)
        ? unsupportedResult(endpoint, baseUrl, "站点仅返回了签到状态，未执行签到")
        : classifyResponse(response, endpoint, baseUrl);
      const result = attachVerificationMetadata(classifiedResult, transport.cookieMode);
      emitAttemptDiagnostic(
        response,
        result,
        endpointPath,
        transport,
        stage,
        userId,
        userIdSource,
        method,
      );
      return { response, result };
    };

    const runCompatibleActionAttempt = async (
      endpointPath: string,
      transport: CheckinAuthTransport,
      stage: CheckinDiagnosticStage,
      userId: string | null,
      userIdSource: CheckinUserIdSource,
    ): Promise<CheckinAttemptExecution> => {
      const postAttempt = await runActionAttempt(
        endpointPath,
        transport,
        stage,
        userId,
        userIdSource,
        "POST",
      );
      return postAttempt.response.status === 405
        ? runActionAttempt(endpointPath, transport, stage, userId, userIdSource, "GET")
        : postAttempt;
    };

    const discoverUserId = async (
      transport: CheckinAuthTransport,
    ): Promise<string | null> => {
      const endpointPath = "/api/user/self";
      const endpoint = `${baseUrl}${endpointPath}`;
      const response = await this.request(
        endpoint,
        timeoutMs,
        transport.headers,
        { method: "GET" },
      );
      const discoveredUserId = extractUserId(response.payload);
      if (discoveredUserId) {
        knownUserIds.add(discoveredUserId);
      }
      const classified = classifyResponse(response, endpoint, baseUrl);
      const discoveryFailure = discoveredUserId
        ? null
        : classified.success
          ? failedResult(endpoint, "站点未返回可用的用户 ID", "user_id_missing")
          : classified;
      if (discoveryFailure) {
        failures.push(discoveryFailure);
      }
      emitAttemptDiagnostic(
        response,
        discoveryFailure ?? classified,
        endpointPath,
        transport,
        "discover_user",
        null,
        "none",
        "GET",
        discoveredUserId ? "user_id_discovered" : undefined,
      );
      return discoveredUserId;
    };

    const probeCheckinStatus = async (
      transport: CheckinAuthTransport,
      userId: string,
      userIdSource: CheckinUserIdSource,
    ): Promise<{ response: CheckinResponse; inspection: CheckinStatusInspection }> => {
      const endpointPath = `/api/user/checkin?month=${currentMonthKey()}`;
      const endpoint = `${baseUrl}${endpointPath}`;
      const response = await this.request(
        endpoint,
        timeoutMs,
        {
          ...transport.headers,
          ...buildUserIdHeaders(userId),
        },
        { method: "GET" },
      );
      const rawInspection = inspectCheckinStatus(response, endpoint, baseUrl);
      const inspection: CheckinStatusInspection = {
        ...rawInspection,
        diagnosticResult: attachVerificationMetadata(
          rawInspection.diagnosticResult,
          transport.cookieMode,
        ),
        ...(rawInspection.terminalResult
          ? {
              terminalResult: attachVerificationMetadata(
                rawInspection.terminalResult,
                transport.cookieMode,
              ),
            }
          : {}),
      };
      emitAttemptDiagnostic(
        response,
        inspection.diagnosticResult,
        endpointPath,
        transport,
        "checkin_status",
        userId,
        userIdSource,
        "GET",
      );
      return { response, inspection };
    };

    const resolveStatusAttempt = async (
      transport: CheckinAuthTransport,
    ): Promise<ResolvedStatusAttempt | null> => {
      let userId = savedUserId;
      let userIdSource: CheckinUserIdSource = userId ? "saved" : "none";
      if (!userId) {
        userId = await discoverUserId(transport);
        userIdSource = userId ? "discovered" : "none";
        if (!userId) {
          return null;
        }
      }

      let statusAttempt = await probeCheckinStatus(transport, userId, userIdSource);
      if (
        userIdSource === "saved"
        && (statusAttempt.inspection.diagnosticResult.error_code === "user_id_missing"
          || statusAttempt.inspection.diagnosticResult.error_code === "user_id_mismatch")
      ) {
        const discoveredUserId = await discoverUserId(transport);
        if (discoveredUserId && discoveredUserId !== userId) {
          userId = discoveredUserId;
          userIdSource = "discovered";
          statusAttempt = await probeCheckinStatus(transport, userId, userIdSource);
        }
      }
      return {
        ...statusAttempt,
        userId,
        userIdSource,
      };
    };

    const attemptActionWithTransport = async (
      transport: CheckinAuthTransport,
      userId: string,
      userIdSource: CheckinUserIdSource,
      defaultStage: "checkin_direct" | "checkin_cookie",
    ): Promise<CheckinAttemptExecution> => {
      let attempt = await runCompatibleActionAttempt(
        "/api/user/checkin",
        transport,
        userIdSource === "discovered" ? "checkin_discovered_user" : defaultStage,
        userId,
        userIdSource,
      );
      if (
        userIdSource === "saved"
        && (attempt.result.error_code === "user_id_missing"
          || attempt.result.error_code === "user_id_mismatch")
      ) {
        const discoveredUserId = await discoverUserId(transport);
        if (discoveredUserId && discoveredUserId !== userId) {
          attempt = await runCompatibleActionAttempt(
            "/api/user/checkin",
            transport,
            "checkin_discovered_user",
            discoveredUserId,
            "discovered",
          );
        }
      }
      return attempt;
    };

    const transports: CheckinAuthTransport[] = [
      ...buildManagementAuthorizationCandidates(accessToken).map((candidate) => ({
        headers: { Authorization: candidate.headerValue },
        authorizationMode: candidate.mode,
        cookieMode: "none" as const,
      })),
      ...buildManagementCookieCandidates(accessToken).map((candidate) => ({
        headers: { Cookie: candidate.headerValue },
        authorizationMode: "none" as const,
        cookieMode: candidate.mode,
      })),
    ];

    let checkinEndpointObserved = false;
    for (const transport of transports) {
      const statusAttempt = await resolveStatusAttempt(transport);
      if (!statusAttempt) {
        continue;
      }
      const { inspection, response, userId, userIdSource } = statusAttempt;
      if (responseShowsEndpointExists(response)) {
        checkinEndpointObserved = true;
      }

      if (inspection.terminalResult) {
        failures.push(inspection.terminalResult);
        if (
          isTerminalResult(inspection.terminalResult)
          || inspection.terminalResult.error_code === "business_rejected"
          || shouldStopTryingAuthCandidates(inspection.terminalResult)
        ) {
          return finish(inspection.terminalResult);
        }
      }

      if (inspection.authenticated) {
        const actionAttempt = await attemptActionWithTransport(
          transport,
          userId,
          userIdSource,
          transport.cookieMode === "none" ? "checkin_direct" : "checkin_cookie",
        );
        failures.push(actionAttempt.result);
        return finish(actionAttempt.result);
      }

      if (inspection.endpointMissing) {
        const legacyAction = await attemptActionWithTransport(
          transport,
          userId,
          userIdSource,
          transport.cookieMode === "none" ? "checkin_direct" : "checkin_cookie",
        );
        failures.push(legacyAction.result);
        if (responseShowsEndpointExists(legacyAction.response)) {
          checkinEndpointObserved = true;
        }
        if (
          isTerminalResult(legacyAction.result)
          || legacyAction.result.error_code === "business_rejected"
          || shouldStopTryingAuthCandidates(legacyAction.result)
        ) {
          return finish(legacyAction.result);
        }
        continue;
      }

      failures.push(inspection.diagnosticResult);
      if (shouldStopTryingAuthCandidates(inspection.diagnosticResult)) {
        return finish(inspection.diagnosticResult);
      }
    }

    if (!checkinEndpointObserved) {
      for (const candidate of buildManagementCookieCandidates(accessToken)) {
        const transport: CheckinAuthTransport = {
          headers: {
            Cookie: candidate.headerValue,
            "X-Requested-With": "XMLHttpRequest",
          },
          authorizationMode: "none",
          cookieMode: candidate.mode,
        };
        const signInAttempt = await runCompatibleActionAttempt(
          "/api/user/sign_in",
          transport,
          "sign_in_cookie",
          null,
          "none",
        );
        failures.push(signInAttempt.result);
        if (
          isTerminalResult(signInAttempt.result)
          || signInAttempt.result.error_code === "business_rejected"
          || shouldStopTryingAuthCandidates(signInAttempt.result)
        ) {
          return finish(signInAttempt.result);
        }
      }
    }

    if (!checkinEndpointObserved) {
      const voApiV2Result = await this.tryVoApiV2Checkin(baseUrl, accessToken, timeoutMs);
      if (voApiV2Result) {
        return finish(voApiV2Result);
      }
    }

    return finish(selectFinalFailure(failures, checkinEndpoint, baseUrl));
  }

  private async tryVoApiV2Checkin(
    baseUrl: string,
    accessToken: string,
    timeoutMs: number,
  ): Promise<CheckinResult | null> {
    const statsEndpoint = `${baseUrl}/api/check_in/stats`;
    const headers = { Authorization: accessToken };
    const statsResponse = await this.request(
      statsEndpoint,
      timeoutMs,
      headers,
      { method: "GET" },
    );
    if (looksLikeManualVerification(
      statsResponse.bodyText,
      extractResponseMessage(statsResponse),
    )) {
      return manualRequiredResult(statsEndpoint, baseUrl, "站点签到需要人工验证");
    }
    if (!isVoApiV2Envelope(statsResponse.payload)) {
      return null;
    }

    const statsCode = readVoApiV2Code(statsResponse.payload);
    if (statsCode === 2 || statsResponse.status === 401 || statsResponse.status === 403) {
      return failedResult(statsEndpoint, "VoAPI v2 登录状态已过期，请重新保存后台 Token", "access_token_invalid");
    }
    if (statsCode !== 0) {
      return failedResult(
        statsEndpoint,
        extractResponseMessage(statsResponse) || "VoAPI v2 签到状态获取失败",
        statsResponse.status >= 500 ? "server_error" : "business_rejected",
      );
    }

    const statsData = extractPayloadData(statsResponse.payload);
    if (readBoolean(statsData?.todaySigned) === true) {
      return alreadyCheckedResult(statsEndpoint, "今日已签到");
    }

    const actionEndpoint = `${baseUrl}/api/check_in`;
    const actionResponse = await this.request(
      actionEndpoint,
      timeoutMs,
      headers,
      { method: "POST" },
    );
    if (looksLikeManualVerification(
      actionResponse.bodyText,
      extractResponseMessage(actionResponse),
    )) {
      return manualRequiredResult(actionEndpoint, baseUrl, "站点签到需要人工验证");
    }
    if (!isVoApiV2Envelope(actionResponse.payload)) {
      return classifyResponse(actionResponse, actionEndpoint, baseUrl);
    }

    const actionCode = readVoApiV2Code(actionResponse.payload);
    if (actionCode === 1) {
      return alreadyCheckedResult(
        actionEndpoint,
        "今日已签到",
        extractVoApiV2Reward(actionResponse.payload),
      );
    }
    if (actionCode === 2) {
      return failedResult(actionEndpoint, "VoAPI v2 登录状态已过期，请重新保存后台 Token", "access_token_invalid");
    }
    if (actionCode === 0) {
      return {
        status: "success",
        success: true,
        message: extractResponseMessage(actionResponse) || "签到成功",
        endpoint: actionEndpoint,
        ...(extractVoApiV2Reward(actionResponse.payload)
          ? { reward: extractVoApiV2Reward(actionResponse.payload) }
          : {}),
      };
    }
    return failedResult(
      actionEndpoint,
      extractResponseMessage(actionResponse) || "VoAPI v2 签到失败",
      actionResponse.status >= 500 ? "server_error" : "business_rejected",
    );
  }

  private async request(
    endpoint: string,
    timeoutMs: number,
    headers: Record<string, string>,
    options: CheckinRequestOptions = {},
  ): Promise<CheckinResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const method = options.method ?? "POST";
      const response = await this.fetchImpl(endpoint, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
        },
        ...(method === "POST" ? { body: options.body ?? "{}" } : {}),
        signal: controller.signal,
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
      return {
        status: response.status,
        payload,
        bodyText,
        durationMs: Date.now() - startedAt,
        responseKind: classifyResponseKind(bodyText, payload),
      };
    } catch (error) {
      const message = describeCheckinNetworkError(error);
      return {
        status: 0,
        payload: { success: false, message },
        bodyText: message,
        durationMs: Date.now() - startedAt,
        responseKind: "network_error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function inspectCheckinStatus(
  response: CheckinResponse,
  endpoint: string,
  baseUrl: string,
): CheckinStatusInspection {
  const message = extractResponseMessage(response);
  if (looksLikeManualVerification(response.bodyText, message)) {
    const result = manualRequiredResult(endpoint, baseUrl, "站点签到需要人工验证");
    return { authenticated: false, endpointMissing: false, diagnosticResult: result, terminalResult: result };
  }
  if (ALREADY_CHECKED_PATTERN.test(message)) {
    const result = alreadyCheckedResult(endpoint, message);
    return { authenticated: true, endpointMissing: false, diagnosticResult: result, terminalResult: result };
  }
  if (response.status >= 200 && response.status < 300 && payloadSignalsSuccess(response.payload)) {
    if (statusShowsCheckedInToday(response.payload)) {
      const result = alreadyCheckedResult(endpoint, "今日已签到");
      return { authenticated: true, endpointMissing: false, diagnosticResult: result, terminalResult: result };
    }
    if (statusRequiresCaptcha(response.payload)) {
      const result = manualRequiredResult(endpoint, baseUrl, "站点签到需要图形验证码，请打开站点处理");
      return { authenticated: true, endpointMissing: false, diagnosticResult: result, terminalResult: result };
    }
    const diagnosticResult: CheckinResult = {
      status: "success",
      success: true,
      message: "签到状态已获取",
      endpoint,
    };
    return { authenticated: true, endpointMissing: false, diagnosticResult };
  }

  const result = classifyResponse(response, endpoint, baseUrl);
  return {
    authenticated: result.error_code === "business_rejected",
    endpointMissing: result.error_code === "endpoint_missing",
    diagnosticResult: result,
    ...(result.error_code === "business_rejected" ? { terminalResult: result } : {}),
  };
}

function classifyResponse(
  response: CheckinResponse,
  endpoint: string,
  baseUrl: string,
): CheckinResult {
  const message = extractResponseMessage(response);
  if (looksLikeManualVerification(response.bodyText, message)) {
    return manualRequiredResult(endpoint, baseUrl, "站点需要 Cloudflare / Turnstile / 验证码人工验证");
  }
  if (ALREADY_CHECKED_PATTERN.test(message)) {
    return alreadyCheckedResult(endpoint, message, extractReward(response.payload));
  }
  if (response.status >= 200 && response.status < 300 && payloadSignalsSuccess(response.payload)) {
    return {
      status: "success",
      success: true,
      message: message || "签到成功",
      endpoint,
      reward: extractReward(response.payload),
    };
  }
  if (response.status === 404 || response.status === 405) {
    return unsupportedResult(endpoint, baseUrl, "站点不支持该签到接口");
  }

  const errorCode = classifyErrorCode(response, message);
  const normalizedMessage = isAuthErrorCode(errorCode)
    ? `签到鉴权失败：${message || "站点拒绝了已保存的鉴权信息"}`
    : errorCode === "business_rejected"
      ? message || "站点已接受鉴权，但拒绝了签到请求"
      : message || defaultFailureMessage(response.status, errorCode);
  return failedResult(endpoint, normalizedMessage, errorCode);
}

function classifyErrorCode(response: CheckinResponse, message: string): CheckinErrorCode {
  if (response.status === 0) return "network_error";
  if (response.status === 429) return "rate_limited";
  if (USER_ID_MISMATCH_PATTERN.test(message)) return "user_id_mismatch";
  if (USER_ID_MISSING_PATTERN.test(message)) return "user_id_missing";
  if (ACCESS_TOKEN_INVALID_PATTERN.test(message)) return "access_token_invalid";
  if (response.status === 401 || response.status === 403 || AUTH_NOT_LOGGED_IN_PATTERN.test(message)) {
    return "auth_not_logged_in";
  }
  if (response.status >= 500) return "server_error";
  if (response.status >= 200 && response.status < 300) return "business_rejected";
  return "unknown_failure";
}

function defaultFailureMessage(status: number, errorCode: CheckinErrorCode): string {
  if (errorCode === "business_rejected") return "站点已接受鉴权，但拒绝了签到请求";
  if (errorCode === "rate_limited") return "签到请求过于频繁，请稍后再试";
  if (errorCode === "network_error") return "签到请求失败或超时";
  if (errorCode === "server_error") return status
    ? `站点签到服务异常（HTTP ${status}）`
    : "站点签到服务异常";
  return status ? `签到失败（HTTP ${status}）` : "签到请求失败";
}

function manualRequiredResult(endpoint: string, baseUrl: string, message: string): CheckinResult {
  return {
    status: "manual_required",
    success: false,
    message,
    endpoint,
    manual_url: buildManualUrl(baseUrl),
    error_code: "turnstile_required",
  };
}

function attachVerificationMetadata(
  result: CheckinResult,
  cookieMode: ManagementCookieMode | "none",
): CheckinResult {
  if (result.status !== "manual_required" || cookieMode === "none") {
    return result;
  }
  return {
    ...result,
    verification: {
      cookie_mode: cookieMode as CheckinVerificationCookieMode,
    },
  };
}

function alreadyCheckedResult(
  endpoint: string,
  message: string,
  reward?: string,
): CheckinResult {
  return {
    status: "already_checked",
    success: true,
    message: message || "今日已签到",
    endpoint,
    ...(reward ? { reward } : {}),
  };
}

function unsupportedResult(endpoint: string, baseUrl: string, message: string): CheckinResult {
  return {
    status: "unsupported",
    success: false,
    message,
    endpoint,
    manual_url: buildManualUrl(baseUrl),
    error_code: "endpoint_missing",
  };
}

function isTerminalResult(result: CheckinResult): boolean {
  return result.status === "success"
    || result.status === "already_checked"
    || result.status === "manual_required";
}

function shouldStopTryingAuthCandidates(result: CheckinResult): boolean {
  return result.error_code === "rate_limited"
    || result.error_code === "network_error"
    || result.error_code === "server_error";
}

function isAuthErrorCode(errorCode: CheckinErrorCode | undefined): boolean {
  return errorCode === "auth_not_logged_in"
    || errorCode === "access_token_invalid"
    || errorCode === "user_id_missing"
    || errorCode === "user_id_mismatch";
}

function normalizeFinalFailure(result: CheckinResult): CheckinResult {
  if (result.success || result.status === "manual_required" || result.error_code === "business_rejected") {
    return result;
  }
  if (result.error_code === "user_id_missing" || result.error_code === "user_id_mismatch") {
    return {
      ...result,
      message: "签到用户 ID 未匹配；已尝试保存值和同一凭证自动发现值",
    };
  }
  if (isAuthErrorCode(result.error_code)) {
    return {
      ...result,
      message: "所有已保存凭证形式均未通过签到鉴权，请重新保存后台 Access Token / Session 与 User ID",
    };
  }
  return result;
}

function selectFinalFailure(
  failures: CheckinResult[],
  endpoint: string,
  baseUrl: string,
): CheckinResult {
  const candidates = failures.filter((result) => !result.success);
  if (candidates.length === 0) {
    return failedResult(endpoint, "签到失败，未获得可识别的站点响应", "unknown_failure");
  }
  const rank: Record<CheckinErrorCode, number> = {
    turnstile_required: 120,
    business_rejected: 115,
    user_id_mismatch: 110,
    user_id_missing: 105,
    access_token_invalid: 100,
    auth_not_logged_in: 95,
    rate_limited: 90,
    endpoint_missing: 80,
    network_error: 70,
    server_error: 60,
    unknown_failure: 50,
  };
  const best = candidates.reduce((current, candidate) => (
    rank[candidate.error_code ?? "unknown_failure"] > rank[current.error_code ?? "unknown_failure"]
      ? candidate
      : current
  ));
  if (candidates.every((candidate) => candidate.error_code === "endpoint_missing")) {
    return unsupportedResult(
      best.endpoint,
      baseUrl,
      "站点不支持当前已知的签到接口",
    );
  }
  return best;
}

function failedResult(
  endpoint: string,
  message: string,
  errorCode: CheckinErrorCode,
): CheckinResult {
  return { status: "failed", success: false, message, endpoint, error_code: errorCode };
}

function buildUserIdHeaders(userId: string): Record<string, string> {
  return {
    "New-API-User": userId,
    "Veloera-User": userId,
    "voapi-user": userId,
    "User-id": userId,
    "X-Api-User": userId,
    "X-User-Id": userId,
    "Rix-Api-User": userId,
    "neo-api-user": userId,
  };
}

function isKnownUnsupportedCheckinPlatform(baseUrl: string): boolean {
  const host = safeUrlHost(baseUrl);
  return host === "aihubmix.com"
    || host === "www.aihubmix.com"
    || host === "console.aihubmix.com"
    || host === "new.sharedchat.cc"
    || /sub2api/i.test(`${host} ${baseUrl}`);
}

function isVoApiV2BaseUrl(baseUrl: string): boolean {
  return /vo[-_\s]?api[-_\s]?v?2|voapi[-_\s]?2/i.test(baseUrl);
}

function isVoApiV2Envelope(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  if (readVoApiV2Code(record) === null) {
    return false;
  }
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    const data = record.data as Record<string, unknown>;
    return "todaySigned" in data
      || "nextAmount" in data
      || "amount" in data
      || "bonusAmount" in data
      || "todayRecord" in data;
  }
  const code = readVoApiV2Code(record);
  return "token" in record
    || "rid" in record
    || ((code === 1 || code === 2) && ("msg" in record || "message" in record));
}

function readVoApiV2Code(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>).code;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function describeCheckinNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "签到请求超时";
  }
  const cause = error instanceof Error
    ? (error as Error & { cause?: { code?: unknown; message?: unknown } }).cause
    : undefined;
  const details = `${
    typeof cause?.code === "string" ? cause.code : ""
  } ${
    typeof cause?.message === "string" ? cause.message : ""
  } ${error instanceof Error ? error.message : String(error)}`;
  if (/SSL|TLS|CERT/i.test(details)) {
    return "签到 TLS 连接失败，请检查系统代理、证书或站点防护";
  }
  if (
    /fetch failed/i.test(error instanceof Error ? error.message : "")
    || /socket|connect/i.test(`${
      typeof cause?.code === "string" ? cause.code : ""
    } ${typeof cause?.message === "string" ? cause.message : ""}`)
  ) {
    return "签到网络连接失败，请检查系统代理或站点是否可访问";
  }
  return error instanceof Error && error.message ? error.message : "签到请求失败";
}

function extractUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  if (root.success === false) {
    return null;
  }
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
  const nestedUser = data.user && typeof data.user === "object" && !Array.isArray(data.user)
    ? data.user as Record<string, unknown>
    : null;
  for (const value of [data.id, data.user_id, data.userId, nestedUser?.id]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return String(Math.trunc(value));
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number(value) > 0) {
      return value.trim();
    }
  }
  return null;
}

function payloadSignalsSuccess(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return record.success === true || record.code === 0;
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["message", "msg", "detail", "error"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  return "";
}

function extractResponseMessage(response: CheckinResponse): string {
  return extractMessage(response.payload)
    || (response.payload === null ? summarizeBody(response.bodyText) : "");
}

function extractReward(payload: unknown): string | undefined {
  const records: Record<string, unknown>[] = [];
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    records.push(root);
    if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
      records.push(root.data as Record<string, unknown>);
    }
  }
  for (const record of records) {
    for (const key of ["reward", "amount", "bonusAmount", "quota", "quota_awarded"] as const) {
      const value = record[key];
      if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return undefined;
}

function extractVoApiV2Reward(payload: unknown): string | undefined {
  const reward = extractReward(payload);
  return reward && Number.isFinite(Number(reward)) ? `$${reward}` : reward;
}

function statusShowsCheckedInToday(payload: unknown): boolean {
  const data = extractPayloadData(payload);
  const stats = data?.stats && typeof data.stats === "object" && !Array.isArray(data.stats)
    ? data.stats as Record<string, unknown>
    : null;
  return readBoolean(stats?.checked_in_today) === true
    || readBoolean(data?.checked_in_today) === true;
}

function statusRequiresCaptcha(payload: unknown): boolean {
  const data = extractPayloadData(payload);
  return readBoolean(data?.captcha_enabled) === true
    || readBoolean(data?.captcha_required) === true;
}

function payloadLooksLikeCheckinStatus(payload: unknown): boolean {
  const data = extractPayloadData(payload);
  return !!data && (
    "stats" in data
    || "checked_in_today" in data
    || "captcha_enabled" in data
    || ("enabled" in data && ("min_quota" in data || "max_quota" in data))
  );
}

function extractPayloadData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  return root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function responseShowsEndpointExists(response: CheckinResponse): boolean {
  return response.status !== 0 && response.status !== 404 && response.status !== 405;
}

function looksLikeManualVerification(bodyText: string, message: string): boolean {
  return MANUAL_REQUIRED_PATTERN.test(`${message} ${bodyText}`)
    && (/<!doctype html|<html|<body/i.test(bodyText) || MANUAL_REQUIRED_PATTERN.test(message));
}

function summarizeBody(bodyText: string): string {
  if (!bodyText) {
    return "";
  }
  if (/<!doctype html|<html|<body/i.test(bodyText)) {
    return "站点返回了网页而不是签到结果";
  }
  return bodyText.slice(0, 240);
}

function classifyResponseKind(bodyText: string, payload: unknown): CheckinResponseKind {
  if (!bodyText) return "empty";
  if (payload !== null) return "json";
  if (/<!doctype html|<html|<body/i.test(bodyText)) return "html";
  return "text";
}

function diagnosticMessageCode(result: CheckinResult): CheckinDiagnosticMessageCode {
  if (result.status === "success") return "success";
  if (result.status === "already_checked") return "already_checked";
  return result.error_code ?? "unknown_failure";
}

function sanitizeDiagnosticMessage(message: string, sensitiveValues: string[]): string {
  let sanitized = message.replace(/[\u0000-\u001f\u007f]+/g, " ");
  const uniqueSensitiveValues = Array.from(new Set(
    sensitiveValues.map((value) => value.trim()).filter(Boolean),
  )).sort((left, right) => right.length - left.length);
  for (const value of uniqueSensitiveValues) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(value), "gi"), "[REDACTED]");
  }
  sanitized = sanitized
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .replace(/\b[A-Za-z0-9_./+=-]{24,}\b/g, "[REDACTED]")
    .replace(/\b\d{4,}\b/g, "[ID]")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emitDiagnostic(
  diagnostics: CheckinDiagnosticsOptions | undefined,
  event: CheckinDiagnosticAttempt,
): void {
  if (!diagnostics?.onDiagnostic) {
    return;
  }
  try {
    diagnostics.onDiagnostic(event);
  } catch {
    // Diagnostics must never change the check-in result.
  }
}

function currentMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildManualUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (/anyrouter|wong/i.test(normalized)) {
    return `${normalized}/console/topup`;
  }
  if (isVoApiV2BaseUrl(normalized)) {
    return `${normalized}/checkIn?_userMenuKey=checkIn`;
  }
  return `${normalized}/console/personal`;
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-host";
  }
}

function redactResult(result: CheckinResult, secret: string): CheckinResult {
  const bearerMatch = secret.match(/^Bearer\s+(.+)$/i);
  const candidates = [secret, bearerMatch?.[1]?.trim() ?? ""]
    .filter((value) => value.length >= 4);
  let message = result.message;
  for (const candidate of candidates) {
    message = message.split(candidate).join("[REDACTED]");
  }
  return { ...result, message };
}
