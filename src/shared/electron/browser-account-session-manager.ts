import { randomUUID } from "node:crypto";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";
import {
  normalizeBrowserOrigin,
  type SiteBalanceSession,
} from "../balance/site-balance-sessions.js";
import type { ManagementRequestContext } from "../services/management-auth.js";

export type BrowserAccountAuthMode = "unknown" | "modern" | "legacy";
export type BrowserAccountAuthStatus =
  | "unknown"
  | "checking"
  | "ready"
  | "login_required"
  | "authenticating";

export interface BrowserAccountStatusSnapshot {
  accountKey: string;
  mode: BrowserAccountAuthMode;
  status: BrowserAccountAuthStatus;
}

export interface BrowserAccountDiagnosticEvent {
  event: "login_probe_capability" | "login_probe_result" | "login_canceled";
  authMode?: ManagementRequestContext["authMode"];
  transport?: "session_fetch" | "page_fetch";
  candidatePlatform?: "new_api" | "sub2api" | "none";
  candidateHasUserId?: boolean;
  candidateHasBearer?: boolean;
  httpStatus?: number;
  result?: "ready" | "retry" | "account_mismatch" | "login_required" | "error";
  reason?: "window_close_unverified";
}

export interface BrowserSessionReference {
  browserSessionId: string;
  browserOrigin: string;
  partition: string;
}

export interface BrowserAccountLoginRequest {
  accountKey: string;
  browserSessionId: string;
  browserOrigin: string;
  expectedUserId?: string;
}

export interface BrowserAccountLoginResult {
  status: "ready" | "canceled" | "account_mismatch" | "failed";
  userId?: string;
  message: string;
}

export interface BrowserAccountSessionManagerDependencies {
  createSession: (partition: string) => Session;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  configureInteractiveWindow?: (browserWindow: BrowserWindow) => void;
  getParentWindow?: () => BrowserWindow | null;
  windowIcon?: string;
  randomId?: () => string;
  now?: () => number;
  loginTimeoutMs?: number;
  pollIntervalMs?: number;
  navigationTimeoutMs?: number;
  probeTimeoutMs?: number;
  closeProbeTimeoutMs?: number;
  onStatusChange?: (snapshot: BrowserAccountStatusSnapshot) => void;
  onDiagnostic?: (event: BrowserAccountDiagnosticEvent) => void;
}

interface RuntimeState {
  mode: BrowserAccountAuthMode;
  status: BrowserAccountAuthStatus;
  bearer?: string;
  bearerExpiresAt?: number;
  sid?: string;
  legacyBearer?: string;
  legacyUserId?: string;
  legacyPlatform?: LegacyIdentityPlatform;
  legacyRefreshToken?: string;
  generation: number;
}

interface RefreshBundle {
  bearer: string;
  expiresAt: number;
  sid: string;
}

interface LegacyIdentityCandidate {
  platform: LegacyIdentityPlatform;
  userId: string;
  bearer?: string;
  refreshToken?: string;
}

type LegacyIdentityPlatform = "new_api" | "sub2api";

type LegacyIdentityVerification =
  | {
      kind: "ready";
      userId: string;
      candidate: LegacyIdentityCandidate;
      httpStatus: number;
      transport: "session_fetch" | "page_fetch";
    }
  | {
      kind: "account_mismatch";
      httpStatus: number;
      transport: "session_fetch" | "page_fetch";
    }
  | {
      kind: "login_required";
      httpStatus: number;
      transport: "session_fetch" | "page_fetch";
    };

interface LoginTask {
  request: BrowserAccountLoginRequest;
  promise: Promise<BrowserAccountLoginResult>;
  resolve: (result: BrowserAccountLoginResult) => void;
  window?: BrowserWindow;
  pollTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  probePromise?: Promise<BrowserAccountLoginResult | null>;
  closeRequested?: boolean;
  finished: boolean;
}

interface JsonResponse {
  status: number;
  payload: unknown;
}

interface PageFetchResult {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

const PARTITION_PREFIX = "persist:codedeck-newapi-";
const LOGIN_NAVIGATION_ORIGINS = new Set([
  "https://connect.linux.do",
  "https://linux.do",
]);
const REFRESH_SKEW_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_200;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_CLOSE_PROBE_TIMEOUT_MS = 2_000;

export class BrowserLoginRequiredError extends Error {
  readonly code = "login_required";

  constructor(message: string = "浏览器登录已失效，请重新登录") {
    super(message);
    this.name = "BrowserLoginRequiredError";
  }
}

export class BrowserAccountSessionManager {
  private readonly states = new Map<string, RuntimeState>();
  private readonly refreshes = new Map<string, Promise<ManagementRequestContext>>();
  private readonly sub2ApiRefreshes = new Map<string, Promise<LegacyIdentityCandidate>>();
  private readonly sessions = new Map<string, Session>();
  private readonly configuredSessions = new WeakSet<Session>();
  private readonly loginTasks = new Map<string, LoginTask>();
  private readonly loginQueue: LoginTask[] = [];
  private readonly recoveryWindows = new Map<BrowserWindow, string>();
  private readonly legacyPageWindows = new Map<string, Promise<BrowserWindow>>();
  private activeLoginTask: LoginTask | null = null;

  constructor(private readonly dependencies: BrowserAccountSessionManagerDependencies) {}

  createReference(baseUrl: string): BrowserSessionReference {
    const browserSessionId = sanitizeOpaqueId(
      (this.dependencies.randomId ?? randomUUID)(),
    );
    const browserOrigin = normalizeBrowserOrigin(baseUrl);
    return {
      browserSessionId,
      browserOrigin,
      partition: browserPartitionName(browserSessionId),
    };
  }

  registerAccount(accountKey: string): void {
    this.ensureState(accountKey);
  }

  getPartitionName(account: SiteBalanceSession): string {
    validateBrowserAccount(account);
    return browserPartitionName(requireBrowserSessionId(account));
  }

  getStatus(accountKey: string): BrowserAccountStatusSnapshot {
    const state = this.ensureState(accountKey);
    return { accountKey, mode: state.mode, status: state.status };
  }

  async getRequestContext(
    accountKey: string,
    account: SiteBalanceSession,
  ): Promise<ManagementRequestContext> {
    return this.resolveRequestContext(accountKey, account, false);
  }

  openLogin(request: BrowserAccountLoginRequest): Promise<BrowserAccountLoginResult> {
    const normalizedRequest = normalizeLoginRequest(request);
    const existing = this.loginTasks.get(normalizedRequest.accountKey);
    if (existing) {
      if (existing.window && !existing.window.isDestroyed()) {
        existing.window.show();
        existing.window.focus();
      }
      return existing.promise;
    }

    let resolveTask!: (result: BrowserAccountLoginResult) => void;
    const promise = new Promise<BrowserAccountLoginResult>((resolve) => {
      resolveTask = resolve;
    });
    const task: LoginTask = {
      request: normalizedRequest,
      promise,
      resolve: resolveTask,
      finished: false,
    };
    this.loginTasks.set(normalizedRequest.accountKey, task);
    this.loginQueue.push(task);
    this.setStatus(normalizedRequest.accountKey, "authenticating");
    this.pumpLoginQueue();
    return promise;
  }

  async logout(accountKey: string, account: SiteBalanceSession): Promise<void> {
    await this.resetAccountRuntime(accountKey, "login_required");
    await this.clearOrigin(
      requireBrowserSessionId(account),
      requireBrowserOrigin(account),
    );
  }

  async deleteAccount(
    accountKey: string,
    account: SiteBalanceSession,
    clearWholePartition: boolean,
  ): Promise<void> {
    await this.resetAccountRuntime(accountKey, "login_required");
    try {
      if (clearWholePartition) {
        await this.clearPartition(requireBrowserSessionId(account));
      } else {
        await this.clearOrigin(
          requireBrowserSessionId(account),
          requireBrowserOrigin(account),
        );
      }
    } finally {
      this.states.delete(accountKey);
    }
  }

  async discardReference(accountKey: string, browserSessionId: string): Promise<void> {
    const state = this.ensureState(accountKey);
    state.generation += 1;
    this.refreshes.delete(accountKey);
    this.sub2ApiRefreshes.delete(accountKey);
    this.closeRecoveryWindows(accountKey);
    await this.cancelLogin(accountKey);
    try {
      await this.clearPartition(sanitizeOpaqueId(browserSessionId));
    } finally {
      this.states.delete(accountKey);
    }
  }

  async cancelLogin(accountKey: string): Promise<void> {
    const task = this.loginTasks.get(accountKey);
    if (task) {
      await this.completeLogin(task, {
        status: "canceled",
        message: "已取消浏览器登录",
      });
    }
  }

  async shutdown(): Promise<void> {
    for (const state of this.states.values()) {
      state.generation += 1;
    }
    const tasks = [...this.loginTasks.values()];
    await Promise.all(tasks.map((task) => this.completeLogin(task, {
      status: "canceled",
      message: "应用正在退出",
    })));
    for (const browserWindow of this.recoveryWindows.keys()) {
      if (!browserWindow.isDestroyed()) browserWindow.close();
    }
    this.recoveryWindows.clear();
    this.legacyPageWindows.clear();
    this.refreshes.clear();
    this.sub2ApiRefreshes.clear();
    this.states.clear();
    this.sessions.clear();
  }

  private async resolveRequestContext(
    accountKey: string,
    account: SiteBalanceSession,
    allowLoginRequired: boolean,
  ): Promise<ManagementRequestContext> {
    validateBrowserAccount(account);
    const state = this.ensureState(accountKey);
    if (state.status === "login_required" && !allowLoginRequired) {
      throw new BrowserLoginRequiredError();
    }
    if (
      state.mode === "modern"
      && state.bearer
      && (state.bearerExpiresAt ?? 0) > this.now() + REFRESH_SKEW_MS
    ) {
      return this.buildModernContext(accountKey, account, state.bearer);
    }
    if (state.mode === "legacy" && state.status === "ready") {
      return this.buildLegacyContext(accountKey, account);
    }

    const existing = this.refreshes.get(accountKey);
    if (existing) {
      return existing;
    }
    const generation = state.generation;
    const refresh = this.refreshOrDetect(accountKey, account, generation, allowLoginRequired)
      .finally(() => {
        if (this.refreshes.get(accountKey) === refresh) {
          this.refreshes.delete(accountKey);
        }
      });
    this.refreshes.set(accountKey, refresh);
    return refresh;
  }

  private async refreshOrDetect(
    accountKey: string,
    account: SiteBalanceSession,
    generation: number,
    allowUnverifiedLegacy: boolean,
  ): Promise<ManagementRequestContext> {
    this.setStatus(accountKey, "checking");
    const browserSession = this.getSession(requireBrowserSessionId(account));
    const state = this.ensureState(accountKey);
    const first = await this.performRefresh(browserSession, requireBrowserOrigin(account), state.sid);
    let result = first;
    if (isSidMismatch(first) && state.sid) {
      state.sid = undefined;
      result = await this.performRefresh(browserSession, requireBrowserOrigin(account));
    }
    if (state.generation !== generation) {
      throw new BrowserLoginRequiredError();
    }

    if (result.kind === "bundle") {
      await browserSession.cookies.flushStore();
      if (state.generation !== generation) {
        throw new BrowserLoginRequiredError();
      }
      state.mode = "modern";
      state.status = "ready";
      state.bearer = result.bundle.bearer;
      state.bearerExpiresAt = result.bundle.expiresAt;
      state.sid = result.bundle.sid;
      state.legacyBearer = undefined;
      state.legacyUserId = undefined;
      state.legacyPlatform = undefined;
      state.legacyRefreshToken = undefined;
      this.emitStatus(accountKey);
      return this.buildModernContext(accountKey, account, result.bundle.bearer);
    }
    if (result.kind === "legacy") {
      state.mode = "legacy";
      state.bearer = undefined;
      state.bearerExpiresAt = undefined;
      state.sid = undefined;
      state.legacyBearer = undefined;
      state.legacyUserId = undefined;
      state.legacyPlatform = undefined;
      state.legacyRefreshToken = undefined;
      if (allowUnverifiedLegacy) {
        return this.buildLegacyContext(accountKey, account, true);
      }
      return this.recoverLegacyRequestContext(accountKey, account, generation);
    }
    if (result.kind === "login_required") {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError();
    }
    if (result.kind === "sid_mismatch") {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError();
    }
    this.setStatus(accountKey, "unknown");
    throw new Error(result.message);
  }

  private async performRefresh(
    browserSession: Session,
    origin: string,
    sid?: string,
  ): Promise<
    | { kind: "bundle"; bundle: RefreshBundle }
    | { kind: "legacy" }
    | { kind: "login_required" }
    | { kind: "sid_mismatch" }
    | { kind: "error"; message: string }
  > {
    let response: Response;
    try {
      response = await fetchWithTimeout(browserSession.fetch.bind(browserSession), `${origin}/api/user/auth/refresh`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: origin,
          ...(sid ? { "X-Auth-Session": sid } : {}),
        },
        body: "{}",
      }, this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    } catch {
      return { kind: "error", message: "浏览器登录状态检查失败，请稍后重试" };
    }
    const payload = await readJsonResponseWithin(
      response,
      this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );
    const bundle = parseRefreshBundle(payload.payload);
    if (response.ok && bundle) {
      return { kind: "bundle", bundle };
    }
    if (response.status === 409 && modernErrorCode(payload.payload) === "AUTH_SESSION_MISMATCH") {
      return { kind: "sid_mismatch" };
    }
    if (
      (response.status === 401 || response.status === 403)
      && isModernAuthPayload(payload.payload)
    ) {
      return { kind: "login_required" };
    }
    if (
      response.status === 404
      || response.status === 405
      || (!bundle && !isModernAuthPayload(payload.payload))
    ) {
      return { kind: "legacy" };
    }
    return { kind: "error", message: `浏览器登录协议响应异常（HTTP ${response.status}）` };
  }

  private buildModernContext(
    accountKey: string,
    account: SiteBalanceSession,
    bearer: string,
  ): ManagementRequestContext {
    const boundFetch = this.buildBoundFetch(account);
    const generation = this.ensureState(accountKey).generation;
    return {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        const requestBearer = await this.resolveModernBearerForRequest(
          accountKey,
          account,
          generation,
        );
        const requestHeaders = withAuthoritativeBearer(init?.headers, requestBearer);
        const response = await boundFetch(input, { ...init, headers: requestHeaders });
        this.assertGeneration(accountKey, generation);
        if (response.status !== 401 && response.status !== 403) {
          return response;
        }

        const state = this.states.get(accountKey);
        let retryBearer = state?.mode === "modern"
          && state.status === "ready"
          && state.bearer
          && state.bearer !== requestBearer
          ? state.bearer
          : "";
        if (!retryBearer) {
          if (state?.bearer === requestBearer) {
            state.bearer = undefined;
            state.bearerExpiresAt = undefined;
          }
          retryBearer = await this.resolveModernBearerForRequest(
            accountKey,
            account,
            generation,
          );
        }
        const retryHeaders = withAuthoritativeBearer(init?.headers, retryBearer);
        const retryResponse = await boundFetch(input, {
          ...init,
          headers: retryHeaders,
        });
        this.assertGeneration(accountKey, generation);
        if (retryResponse.status === 401 || retryResponse.status === 403) {
          const retryState = this.states.get(accountKey);
          if (retryState?.bearer === retryBearer) {
            this.clearTransientState(accountKey, "login_required");
          }
        }
        return retryResponse;
      }) as typeof fetch,
      headers: { Authorization: `Bearer ${bearer}` },
      userIdHeaderPolicy: "omit",
      authMode: "browser_bearer",
    };
  }

  private buildLegacyContext(
    accountKey: string,
    account: SiteBalanceSession,
    allowUnverified: boolean = false,
  ): ManagementRequestContext {
    const boundFetch = this.buildBoundFetch(account);
    const state = this.ensureState(accountKey);
    const generation = state.generation;
    const legacyBearer = state.legacyBearer;
    const legacyUserId = state.legacyUserId;
    const legacyPlatform = state.legacyPlatform;
    const legacyRefreshToken = state.legacyRefreshToken;
    const headers = buildLegacyIdentityHeaders(
      legacyUserId
        ? {
            platform: legacyPlatform ?? "new_api",
            userId: legacyUserId,
            ...(legacyBearer ? { bearer: legacyBearer } : {}),
            ...(legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}),
          }
        : null,
    );
    return {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        const requestState = this.assertLegacyRuntime(accountKey, generation, allowUnverified);
        const requestCandidate = runtimeCandidate(requestState);
        const requestHeaders = allowUnverified ? null : new Headers(init?.headers);
        if (!allowUnverified) {
          requestHeaders!.delete("Authorization");
          requestHeaders!.delete("New-Api-User");
          for (const [name, value] of Object.entries(buildLegacyIdentityHeaders(requestCandidate))) {
            requestHeaders!.set(name, value);
          }
        }
        const response = await boundFetch(input, requestHeaders
          ? { ...init, headers: requestHeaders }
          : init);
        const liveState = this.assertLegacyRuntime(accountKey, generation, allowUnverified);
        if (response.status === 401 || response.status === 403) {
          const liveCandidate = runtimeCandidate(liveState);
          if (liveCandidate?.platform === "new_api") {
            const pageResponse = await this.fetchLegacyRequestInPage(
              accountKey,
              account,
              input,
              requestHeaders ? { ...init, headers: requestHeaders } : init,
            );
            this.assertLegacyRuntime(accountKey, generation, allowUnverified);
            if (pageResponse.status !== 401 && pageResponse.status !== 403) {
              return pageResponse;
            }
          }
          if (
            liveState.legacyPlatform === "sub2api"
            && liveState.legacyUserId
            && liveState.legacyBearer
            && liveState.legacyRefreshToken
          ) {
            const refreshed = sameLegacyIdentityCredentials(requestCandidate, liveCandidate)
              ? await this.refreshSub2ApiRuntime(
                  accountKey,
                  account,
                  generation,
                  liveState.legacyUserId,
                  liveState.legacyBearer,
                  liveState.legacyRefreshToken,
                )
              : liveCandidate;
            const retryHeaders = new Headers(requestHeaders ?? init?.headers);
            for (const name of ["Authorization", "New-Api-User"]) {
              retryHeaders.delete(name);
            }
            for (const [name, value] of Object.entries(buildLegacyIdentityHeaders(refreshed))) {
              retryHeaders.set(name, value);
            }
            const retryResponse = await boundFetch(input, { ...init, headers: retryHeaders });
            if (retryResponse.status === 401 || retryResponse.status === 403) {
              const retryState = this.assertLegacyRuntime(accountKey, generation, false);
              if (sameLegacyIdentityCredentials(runtimeCandidate(retryState), refreshed)) {
                this.clearTransientState(accountKey, "login_required");
              }
            }
            return retryResponse;
          }
          this.clearTransientState(accountKey, "login_required");
        }
        return response;
      }) as typeof fetch,
      headers,
      userIdHeaderPolicy: "legacy_if_required",
      authMode: "browser_cookie",
    };
  }

  private async recoverLegacyRequestContext(
    accountKey: string,
    account: SiteBalanceSession,
    generation: number,
  ): Promise<ManagementRequestContext> {
    const expectedUserId = positiveIntegerString(account.user_id);
    const cookieCandidate: LegacyIdentityCandidate | null = expectedUserId
      ? { platform: "new_api", userId: expectedUserId }
      : null;
    const cookieVerification = await this.verifyLegacyIdentity(
      accountKey,
      account,
      cookieCandidate,
      expectedUserId,
      undefined,
      false,
    );
    this.assertGeneration(accountKey, generation);
    if (cookieVerification.kind === "ready") {
      this.setLegacyRuntime(accountKey, cookieVerification.candidate);
      return this.buildLegacyContext(accountKey, account);
    }
    if (cookieVerification.kind === "account_mismatch") {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError("浏览器中登录的账号与目标账号不一致");
    }

    const recoveredCandidate = await this.recoverLegacyIdentityCandidate(accountKey, account);
    this.assertGeneration(accountKey, generation);
    if (!recoveredCandidate || (expectedUserId && recoveredCandidate.userId !== expectedUserId)) {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError();
    }
    const recoveredVerification = await this.verifyLegacyIdentity(
      accountKey,
      account,
      recoveredCandidate,
      expectedUserId,
    );
    this.assertGeneration(accountKey, generation);
    if (recoveredVerification.kind !== "ready") {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError(
        recoveredVerification.kind === "account_mismatch"
          ? "浏览器中登录的账号与目标账号不一致"
          : undefined,
      );
    }
    this.setLegacyRuntime(accountKey, {
      ...recoveredVerification.candidate,
    });
    return this.buildLegacyContext(accountKey, account);
  }

  private async verifyLegacyIdentity(
    accountKey: string,
    account: SiteBalanceSession,
    candidate: LegacyIdentityCandidate | null,
    expectedUserId: string | null,
    browserWindow?: BrowserWindow,
    allowPageFallback: boolean = true,
  ): Promise<LegacyIdentityVerification> {
    const sessionVerification = await this.verifyLegacyIdentityWithFetch(
      this.buildBoundFetch(account),
      requireBrowserOrigin(account),
      candidate,
      expectedUserId,
    );
    if (
      sessionVerification.kind !== "login_required"
      || (sessionVerification.httpStatus !== 401 && sessionVerification.httpStatus !== 403)
      || candidate?.platform !== "new_api"
      || !allowPageFallback
    ) {
      return sessionVerification;
    }
    try {
      const pageFetch = browserWindow
        ? this.buildPageFetch(browserWindow, requireBrowserOrigin(account))
        : this.buildLegacyPageFetch(accountKey, account);
      const pageVerification = await this.verifyLegacyIdentityWithFetch(
        pageFetch,
        requireBrowserOrigin(account),
        candidate.bearer ? { platform: "new_api", userId: candidate.userId } : candidate,
        expectedUserId,
      );
      if (pageVerification.httpStatus === 0) return sessionVerification;
      return { ...pageVerification, transport: "page_fetch" };
    } catch {
      return sessionVerification;
    }
  }

  private async verifyLegacyIdentityWithFetch(
    requestFetch: typeof fetch,
    browserOrigin: string,
    candidate: LegacyIdentityCandidate | null,
    expectedUserId: string | null,
  ): Promise<LegacyIdentityVerification> {
    let verifiedCandidate = candidate;
    let response = await fetchJson(
      requestFetch,
      `${browserOrigin}${legacyIdentityEndpoint(candidate)}`,
      buildLegacyIdentityHeaders(candidate),
      this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );
    if (
      (response.status === 401 || response.status === 403)
      && candidate?.platform === "new_api"
      && candidate.bearer
    ) {
      verifiedCandidate = { platform: "new_api", userId: candidate.userId };
      response = await fetchJson(
        requestFetch,
        `${browserOrigin}${legacyIdentityEndpoint(verifiedCandidate)}`,
        buildLegacyIdentityHeaders(verifiedCandidate),
        this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      );
    }
    if (!isSuccessfulHttpStatus(response.status)) {
      return { kind: "login_required", httpStatus: response.status, transport: "session_fetch" };
    }
    const platform = verifiedCandidate?.platform ?? "new_api";
    const userId = extractBrowserUserId(response.payload, platform);
    if (!userId) {
      return { kind: "login_required", httpStatus: response.status, transport: "session_fetch" };
    }
    if (
      (verifiedCandidate && verifiedCandidate.userId !== userId)
      || (expectedUserId && expectedUserId !== userId)
    ) {
      return { kind: "account_mismatch", httpStatus: response.status, transport: "session_fetch" };
    }
    return {
      kind: "ready",
      userId,
      candidate: verifiedCandidate
        ? { ...verifiedCandidate, userId }
        : { platform: "new_api", userId },
      httpStatus: response.status,
      transport: "session_fetch",
    };
  }

  private refreshSub2ApiRuntime(
    accountKey: string,
    account: SiteBalanceSession,
    generation: number,
    userId: string,
    bearer: string,
    refreshToken: string,
  ): Promise<LegacyIdentityCandidate> {
    const existing = this.sub2ApiRefreshes.get(accountKey);
    if (existing) return existing;
    const operation = this.performSub2ApiRefresh(
      accountKey,
      account,
      generation,
      userId,
      bearer,
      refreshToken,
    ).finally(() => {
      if (this.sub2ApiRefreshes.get(accountKey) === operation) {
        this.sub2ApiRefreshes.delete(accountKey);
      }
    });
    this.sub2ApiRefreshes.set(accountKey, operation);
    return operation;
  }

  private async performSub2ApiRefresh(
    accountKey: string,
    account: SiteBalanceSession,
    generation: number,
    userId: string,
    bearer: string,
    refreshToken: string,
  ): Promise<LegacyIdentityCandidate> {
    const state = this.assertLegacyRuntime(accountKey, generation, false);
    if (
      state.legacyUserId !== userId
      || state.legacyBearer !== bearer
      || state.legacyPlatform !== "sub2api"
      || state.legacyRefreshToken !== refreshToken
    ) {
      throw new BrowserLoginRequiredError();
    }
    const origin = requireBrowserOrigin(account);
    const response = await fetchWithTimeout(this.buildBoundFetch(account), `${origin}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    this.assertGeneration(accountKey, generation);
    const payload = await readJsonResponseWithin(
      response,
      this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );
    const refreshedCredentials = response.ok
      ? parseSub2ApiRefreshCredentials(payload.payload, refreshToken)
      : null;
    if (!refreshedCredentials) {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError();
    }
    const candidate: LegacyIdentityCandidate = {
      platform: "sub2api",
      userId,
      bearer: refreshedCredentials.bearer,
      refreshToken: refreshedCredentials.refreshToken,
    };
    const verification = await this.verifyLegacyIdentity(accountKey, account, candidate, userId);
    this.assertGeneration(accountKey, generation);
    if (verification.kind !== "ready") {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError(
        verification.kind === "account_mismatch"
          ? "浏览器中登录的账号与目标账号不一致"
          : undefined,
      );
    }
    this.setLegacyRuntime(accountKey, candidate);
    return candidate;
  }

  private async recoverLegacyIdentityCandidate(
    accountKey: string,
    account: SiteBalanceSession,
  ): Promise<LegacyIdentityCandidate | null> {
    const browserSessionId = requireBrowserSessionId(account);
    const browserOrigin = requireBrowserOrigin(account);
    const browserWindow = this.dependencies.createWindow(
      this.buildWindowOptions(browserPartitionName(browserSessionId)),
    );
    this.recoveryWindows.set(browserWindow, accountKey);
    this.configureRecoveryWindow(browserWindow, browserOrigin);
    try {
      await loadWindowUrlWithTimeout(
        browserWindow,
        browserOrigin,
        this.dependencies.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
      );
      if (browserWindow.isDestroyed()) return null;
      return await this.readLegacyIdentityCandidateFromWindow(browserWindow, browserOrigin);
    } catch {
      return null;
    } finally {
      this.recoveryWindows.delete(browserWindow);
      if (!browserWindow.isDestroyed()) browserWindow.close();
    }
  }

  private configureRecoveryWindow(browserWindow: BrowserWindow, allowedOrigin: string): void {
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isExactOriginNavigation(targetUrl, allowedOrigin)) event.preventDefault();
    });
    browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
      if (!isExactOriginNavigation(targetUrl, allowedOrigin)) event.preventDefault();
    });
    browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  }

  private buildBoundFetch(account: SiteBalanceSession): typeof fetch {
    const origin = requireBrowserOrigin(account);
    const browserSession = this.getSession(requireBrowserSessionId(account));
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof input === "string" ? input : input.toString());
      if (target.origin !== origin) {
        throw new Error("浏览器会话拒绝跨来源请求");
      }
      return browserSession.fetch(target.toString(), {
        ...init,
        credentials: "include",
        redirect: "manual",
      });
    }) as typeof fetch;
  }

  private buildLegacyPageFetch(accountKey: string, account: SiteBalanceSession): typeof fetch {
    const origin = requireBrowserOrigin(account);
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const browserWindow = await this.ensureLegacyPageWindow(accountKey, account);
      return this.executePageFetch(browserWindow, origin, input, init);
    }) as typeof fetch;
  }

  private buildPageFetch(browserWindow: BrowserWindow, expectedOrigin: string): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
      this.executePageFetch(browserWindow, expectedOrigin, input, init)) as typeof fetch;
  }

  private async fetchLegacyRequestInPage(
    accountKey: string,
    account: SiteBalanceSession,
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    return this.buildLegacyPageFetch(accountKey, account)(input, init);
  }

  private async ensureLegacyPageWindow(
    accountKey: string,
    account: SiteBalanceSession,
  ): Promise<BrowserWindow> {
    const existing = this.legacyPageWindows.get(accountKey);
    if (existing) {
      const browserWindow = await existing;
      if (!browserWindow.isDestroyed()) return browserWindow;
      this.legacyPageWindows.delete(accountKey);
    }
    const browserSessionId = requireBrowserSessionId(account);
    const browserOrigin = requireBrowserOrigin(account);
    const operation = (async () => {
      const browserWindow = this.dependencies.createWindow(
        this.buildWindowOptions(browserPartitionName(browserSessionId)),
      );
      this.recoveryWindows.set(browserWindow, accountKey);
      this.configureRecoveryWindow(browserWindow, browserOrigin);
      try {
        await loadWindowUrlWithTimeout(
          browserWindow,
          browserOrigin,
          this.dependencies.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
        );
        if (browserWindow.isDestroyed()) throw new BrowserLoginRequiredError();
        return browserWindow;
      } catch (error) {
        this.recoveryWindows.delete(browserWindow);
        if (!browserWindow.isDestroyed()) browserWindow.close();
        throw error;
      }
    })();
    this.legacyPageWindows.set(accountKey, operation);
    try {
      return await operation;
    } catch (error) {
      if (this.legacyPageWindows.get(accountKey) === operation) {
        this.legacyPageWindows.delete(accountKey);
      }
      throw error;
    }
  }

  private async executePageFetch(
    browserWindow: BrowserWindow,
    expectedOrigin: string,
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    if (browserWindow.isDestroyed()) throw new BrowserLoginRequiredError();
    const currentUrl = browserWindow.webContents.getURL();
    if (new URL(currentUrl).origin !== expectedOrigin) {
      throw new BrowserLoginRequiredError("浏览器页面不在目标后台来源");
    }
    const target = new URL(requestInputUrl(input));
    if (target.origin !== expectedOrigin) {
      throw new Error("浏览器会话拒绝跨来源请求");
    }
    const request = {
      url: target.toString(),
      method: init?.method ?? "GET",
      headers: [...new Headers(init?.headers).entries()],
      body: serializePageRequestBody(init?.body),
    };
    const serializedOrigin = JSON.stringify(expectedOrigin);
    const serializedRequest = JSON.stringify(request);
    const operation = browserWindow.webContents.executeJavaScript(
      `(async () => {
        if (window.location.origin !== ${serializedOrigin}) return null;
        const request = ${serializedRequest};
        try {
          const response = await window.fetch(request.url, {
            method: request.method,
            headers: request.headers,
            ...(request.body === null ? {} : { body: request.body }),
            credentials: "include",
            cache: "no-store",
            redirect: "manual",
          });
          return {
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            body: await response.text(),
          };
        } catch {
          return null;
        }
      })()`,
      true,
    ) as Promise<unknown>;
    const value = await raceWithAbort(operation, init?.signal);
    const result = parsePageFetchResult(value);
    if (!result) throw new Error("浏览器页面请求失败");
    const body = result.status === 204 || result.status === 205 || result.status === 304
      ? null
      : result.body;
    return new Response(body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  private getSession(browserSessionId: string): Session {
    const existing = this.sessions.get(browserSessionId);
    if (existing) {
      return existing;
    }
    const browserSession = this.dependencies.createSession(browserPartitionName(browserSessionId));
    this.configureSession(browserSession);
    this.sessions.set(browserSessionId, browserSession);
    return browserSession;
  }

  private async clearPartition(browserSessionId: string): Promise<void> {
    const browserSession = this.getSession(browserSessionId);
    try {
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.cookies.flushStore();
    } finally {
      this.sessions.delete(browserSessionId);
    }
  }

  private async clearOrigin(browserSessionId: string, origin: string): Promise<void> {
    const browserSession = this.getSession(browserSessionId);
    try {
      await browserSession.clearStorageData({ origin: normalizeBrowserOrigin(origin) });
    } finally {
      await browserSession.cookies.flushStore();
    }
  }

  private configureSession(browserSession: Session): void {
    if (this.configuredSessions.has(browserSession)) {
      return;
    }
    this.configuredSessions.add(browserSession);
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    browserSession.on("will-download", (event) => event.preventDefault());
  }

  private pumpLoginQueue(): void {
    if (this.activeLoginTask) {
      return;
    }
    const task = this.loginQueue.shift();
    if (!task) {
      return;
    }
    if (task.finished) {
      this.pumpLoginQueue();
      return;
    }
    this.activeLoginTask = task;
    void this.startLogin(task);
  }

  private async startLogin(task: LoginTask): Promise<void> {
    try {
      const partition = browserPartitionName(task.request.browserSessionId);
      this.getSession(task.request.browserSessionId);
      const browserWindow = this.dependencies.createWindow(this.buildWindowOptions(partition));
      task.window = browserWindow;
      this.configureLoginWindow(task, browserWindow);
      this.dependencies.configureInteractiveWindow?.(browserWindow);
      task.timeoutTimer = setTimeout(() => {
        void this.completeLogin(task, { status: "failed", message: "浏览器登录已超时" });
      }, this.dependencies.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS);
      browserWindow.show();
      browserWindow.focus();
      await loadWindowUrlWithTimeout(
        browserWindow,
        task.request.browserOrigin,
        this.dependencies.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
      );
      if (task.finished) {
        return;
      }
      void this.pollLogin(task);
    } catch {
      await this.completeLogin(task, { status: "failed", message: "浏览器登录窗口加载失败" });
    }
  }

  private buildWindowOptions(partition: string): BrowserWindowConstructorOptions {
    const parent = this.dependencies.getParentWindow?.() ?? undefined;
    return {
      title: "CodeDeck 浏览器登录",
      width: 1120,
      height: 820,
      minWidth: 840,
      minHeight: 620,
      show: false,
      autoHideMenuBar: false,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      ...(this.dependencies.windowIcon ? { icon: this.dependencies.windowIcon } : {}),
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
      },
    };
  }

  private configureLoginWindow(task: LoginTask, browserWindow: BrowserWindow): void {
    const allowedOrigin = task.request.browserOrigin;
    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedBrowserNavigation(url, allowedOrigin)) {
        void browserWindow.loadURL(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isAllowedBrowserNavigation(targetUrl, allowedOrigin)) event.preventDefault();
    });
    browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
      if (!isAllowedBrowserNavigation(targetUrl, allowedOrigin)) event.preventDefault();
    });
    browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
    browserWindow.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    browserWindow.on("close", (event) => {
      if (task.finished) {
        return;
      }
      event.preventDefault();
      void this.finalizeLoginOnClose(task);
    });
    browserWindow.on("closed", () => {
      if (!task.finished && !task.closeRequested) {
        void this.completeLogin(task, { status: "canceled", message: "已取消浏览器登录" });
      }
    });
  }

  private async pollLogin(task: LoginTask): Promise<void> {
    if (task.finished || task.closeRequested) return;
    const result = await this.runLoginProbe(task);
    if (task.finished) return;
    if (result) {
      await this.completeLogin(task, result);
      return;
    }
    if (task.closeRequested) return;
    task.pollTimer = setTimeout(() => {
      void this.pollLogin(task);
    }, this.dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  private runLoginProbe(task: LoginTask): Promise<BrowserAccountLoginResult | null> {
    if (task.finished) {
      return Promise.resolve(null);
    }
    if (task.probePromise) {
      return task.probePromise;
    }
    const operation = this.probeLogin(task).finally(() => {
      if (task.probePromise === operation) {
        task.probePromise = undefined;
      }
    });
    task.probePromise = operation;
    return operation;
  }

  private async probeLogin(task: LoginTask): Promise<BrowserAccountLoginResult | null> {
    const state = this.ensureState(task.request.accountKey);
    if (state.status === "login_required") {
      state.status = "authenticating";
    }
    const account = loginRequestAsAccount(task.request);
    try {
      const context = await this.resolveRequestContext(task.request.accountKey, account, true);
      if (task.finished) return null;
      const legacyIdentityCandidate = context.authMode === "browser_cookie"
        ? await this.readLegacyIdentityCandidate(task)
        : null;
      if (task.finished) return null;
      this.emitDiagnostic({
        event: "login_probe_capability",
        authMode: context.authMode,
        candidatePlatform: legacyIdentityCandidate?.platform ?? "none",
        candidateHasUserId: Boolean(legacyIdentityCandidate?.userId),
        candidateHasBearer: Boolean(legacyIdentityCandidate?.bearer),
      });
      const verification = context.authMode === "browser_cookie"
        ? await this.verifyLegacyIdentity(
            task.request.accountKey,
            account,
            legacyIdentityCandidate,
            positiveIntegerString(task.request.expectedUserId),
            task.window,
          )
        : await this.verifyLegacyIdentityWithFetch(
            context.fetch,
            task.request.browserOrigin,
            legacyIdentityCandidate,
            positiveIntegerString(task.request.expectedUserId),
          );
      if (task.finished) return null;
      if (verification.kind === "account_mismatch") {
        this.emitDiagnostic({
          event: "login_probe_result",
          authMode: context.authMode,
          transport: verification.transport,
          httpStatus: verification.httpStatus,
          result: "account_mismatch",
        });
        return {
          status: "account_mismatch",
          message: "浏览器中登录的账号与目标账号不一致",
        };
      }
      if (verification.kind === "ready") {
        await this.getSession(task.request.browserSessionId).cookies.flushStore();
        if (task.finished) return null;
        if (context.authMode === "browser_cookie") {
          this.setLegacyRuntime(task.request.accountKey, verification.candidate);
        }
        this.emitDiagnostic({
          event: "login_probe_result",
          authMode: context.authMode,
          transport: verification.transport,
          httpStatus: verification.httpStatus,
          result: "ready",
        });
        return {
          status: "ready",
          userId: verification.userId,
          message: "浏览器登录成功",
        };
      }
      this.emitDiagnostic({
        event: "login_probe_result",
        authMode: context.authMode,
        transport: verification.transport,
        httpStatus: verification.httpStatus,
        result: "retry",
      });
    } catch (error) {
      this.emitDiagnostic({
        event: "login_probe_result",
        result: error instanceof BrowserLoginRequiredError ? "login_required" : "error",
      });
    }
    return null;
  }

  private async finalizeLoginOnClose(task: LoginTask): Promise<void> {
    if (task.finished || task.closeRequested) {
      return;
    }
    task.closeRequested = true;
    if (task.pollTimer) {
      clearTimeout(task.pollTimer);
      task.pollTimer = undefined;
    }
    const closeProbe = (async (): Promise<BrowserAccountLoginResult | null> => {
      const activeProbe = task.probePromise;
      let result = await this.runLoginProbe(task);
      if (!result && activeProbe && !task.finished) {
        result = await this.runLoginProbe(task);
      }
      return result;
    })();
    const result = await settleWithin(
      closeProbe,
      this.dependencies.closeProbeTimeoutMs ?? DEFAULT_CLOSE_PROBE_TIMEOUT_MS,
      null,
    );
    if (task.finished) {
      return;
    }
    if (result) {
      await this.completeLogin(task, result);
      return;
    }
    this.emitDiagnostic({
      event: "login_canceled",
      reason: "window_close_unverified",
    });
    await this.completeLogin(task, { status: "canceled", message: "已取消浏览器登录" });
  }

  private async readLegacyIdentityCandidate(
    task: LoginTask,
  ): Promise<LegacyIdentityCandidate | null> {
    const expectedUserId = positiveIntegerString(task.request.expectedUserId);
    const browserWindow = task.window;
    if (!browserWindow || browserWindow.isDestroyed()) {
      return expectedUserId ? { platform: "new_api", userId: expectedUserId } : null;
    }
    try {
      const currentUrl = browserWindow.webContents.getURL();
      if (new URL(currentUrl).origin !== task.request.browserOrigin) {
        return expectedUserId ? { platform: "new_api", userId: expectedUserId } : null;
      }
      return await this.readLegacyIdentityCandidateFromWindow(
        browserWindow,
        task.request.browserOrigin,
      ) ?? (expectedUserId ? { platform: "new_api", userId: expectedUserId } : null);
    } catch {
      return expectedUserId ? { platform: "new_api", userId: expectedUserId } : null;
    }
  }

  private async readLegacyIdentityCandidateFromWindow(
    browserWindow: BrowserWindow,
    expectedOrigin: string,
  ): Promise<LegacyIdentityCandidate | null> {
    const currentUrl = browserWindow.webContents.getURL();
    if (new URL(currentUrl).origin !== expectedOrigin) return null;
    const serializedOrigin = JSON.stringify(expectedOrigin);
    const value = await browserWindow.webContents.executeJavaScript(
      `(() => {
        if (window.location.origin !== ${serializedOrigin}) return null;
        const normalizeId = (value) => {
          const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
          if (!/^\\d+$/.test(text)) return null;
          const normalized = text.replace(/^0+/, "");
          return normalized || null;
        };
        try {
          const rawAuthUser = window.localStorage.getItem("auth_user");
          const bearer = (window.localStorage.getItem("auth_token") || "").trim();
          if (rawAuthUser && bearer) {
            const authUser = JSON.parse(rawAuthUser);
            const userId = normalizeId(authUser && authUser.id);
            if (userId) {
              const refreshToken = (window.localStorage.getItem("refresh_token") || "").trim();
              return refreshToken
                ? { platform: "sub2api", userId, bearer, refreshToken }
                : { platform: "sub2api", userId, bearer };
            }
          }
        } catch {}
        try {
          const rawUser = window.localStorage.getItem("user");
          if (rawUser) {
            const user = JSON.parse(rawUser);
            const userId = normalizeId(user && user.id);
            if (userId) {
              const bearer = typeof user.token === "string" ? user.token.trim() : "";
              return bearer
                ? { platform: "new_api", userId, bearer }
                : { platform: "new_api", userId };
            }
          }
        } catch {}
        const userId = normalizeId(window.localStorage.getItem("uid"));
        return userId ? { platform: "new_api", userId } : null;
      })()`,
      true,
    ) as unknown;
    return parseLegacyIdentityCandidate(value);
  }

  private async completeLogin(task: LoginTask, result: BrowserAccountLoginResult): Promise<void> {
    if (task.finished) return;
    task.finished = true;
    if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
    if (task.pollTimer) clearTimeout(task.pollTimer);
    this.loginTasks.delete(task.request.accountKey);
    const queuedIndex = this.loginQueue.indexOf(task);
    if (queuedIndex >= 0) this.loginQueue.splice(queuedIndex, 1);
    if (result.status === "ready") {
      this.setStatus(task.request.accountKey, "ready");
    }
    if (task.window && !task.window.isDestroyed()) {
      task.window.webContents.stop();
      task.window.close();
    }
    if (result.status !== "ready") {
      const state = this.ensureState(task.request.accountKey);
      state.generation += 1;
      this.refreshes.delete(task.request.accountKey);
      this.sub2ApiRefreshes.delete(task.request.accountKey);
      this.clearTransientState(task.request.accountKey, "login_required");
    }
    task.resolve(result);
    if (this.activeLoginTask === task) this.activeLoginTask = null;
    this.pumpLoginQueue();
  }

  private ensureState(accountKey: string): RuntimeState {
    let state = this.states.get(accountKey);
    if (!state) {
      state = { mode: "unknown", status: "unknown", generation: 0 };
      this.states.set(accountKey, state);
    }
    return state;
  }

  private clearTransientState(accountKey: string, status: BrowserAccountAuthStatus): void {
    const state = this.ensureState(accountKey);
    state.mode = "unknown";
    state.status = status;
    state.bearer = undefined;
    state.bearerExpiresAt = undefined;
    state.sid = undefined;
    state.legacyBearer = undefined;
    state.legacyUserId = undefined;
    state.legacyPlatform = undefined;
    state.legacyRefreshToken = undefined;
    this.emitStatus(accountKey);
  }

  private setLegacyRuntime(accountKey: string, candidate: LegacyIdentityCandidate): void {
    const state = this.ensureState(accountKey);
    state.mode = "legacy";
    state.status = "ready";
    state.bearer = undefined;
    state.bearerExpiresAt = undefined;
    state.sid = undefined;
    state.legacyBearer = candidate.bearer;
    state.legacyUserId = candidate.userId;
    state.legacyPlatform = candidate.platform;
    state.legacyRefreshToken = candidate.refreshToken;
    this.emitStatus(accountKey);
  }

  private assertGeneration(accountKey: string, generation: number): void {
    if (this.states.get(accountKey)?.generation !== generation) {
      throw new BrowserLoginRequiredError();
    }
  }

  private async resolveModernBearerForRequest(
    accountKey: string,
    account: SiteBalanceSession,
    generation: number,
  ): Promise<string> {
    this.assertGeneration(accountKey, generation);
    const state = this.states.get(accountKey);
    if (state?.mode === "modern" && state.status === "ready" && state.bearer) {
      return state.bearer;
    }
    const refreshed = await this.resolveRequestContext(accountKey, account, true);
    this.assertGeneration(accountKey, generation);
    const refreshedBearer = refreshed.authMode === "browser_bearer"
      ? new Headers(refreshed.headers).get("Authorization")?.replace(/^Bearer\s+/i, "").trim()
      : "";
    if (!refreshedBearer) {
      this.clearTransientState(accountKey, "login_required");
      throw new BrowserLoginRequiredError();
    }
    return refreshedBearer;
  }

  private assertLegacyRuntime(
    accountKey: string,
    generation: number,
    allowUnverified: boolean,
  ): RuntimeState {
    const state = this.states.get(accountKey);
    if (!state || state.generation !== generation) {
      throw new BrowserLoginRequiredError();
    }
    if (
      !allowUnverified
      && (
        state.mode !== "legacy"
        || state.status !== "ready"
      )
    ) {
      throw new BrowserLoginRequiredError();
    }
    return state;
  }

  private closeRecoveryWindows(accountKey: string): void {
    this.legacyPageWindows.delete(accountKey);
    for (const [browserWindow, ownerAccountKey] of this.recoveryWindows) {
      if (ownerAccountKey !== accountKey) continue;
      this.recoveryWindows.delete(browserWindow);
      if (!browserWindow.isDestroyed()) browserWindow.close();
    }
  }

  private async resetAccountRuntime(
    accountKey: string,
    status: BrowserAccountAuthStatus,
  ): Promise<void> {
    const state = this.ensureState(accountKey);
    state.generation += 1;
    this.refreshes.delete(accountKey);
    this.sub2ApiRefreshes.delete(accountKey);
    this.closeRecoveryWindows(accountKey);
    await this.cancelLogin(accountKey);
    this.clearTransientState(accountKey, status);
  }

  private setStatus(accountKey: string, status: BrowserAccountAuthStatus): void {
    const state = this.ensureState(accountKey);
    state.status = status;
    this.emitStatus(accountKey);
  }

  private emitStatus(accountKey: string): void {
    this.dependencies.onStatusChange?.(this.getStatus(accountKey));
  }

  private emitDiagnostic(event: BrowserAccountDiagnosticEvent): void {
    this.dependencies.onDiagnostic?.(event);
  }

  private now(): number {
    return (this.dependencies.now ?? Date.now)();
  }
}

export function browserPartitionName(browserSessionId: string): string {
  return `${PARTITION_PREFIX}${sanitizeOpaqueId(browserSessionId)}`;
}

export function isAllowedBrowserNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const target = new URL(targetUrl);
    const accountOrigin = normalizeBrowserOrigin(allowedOrigin);
    if (
      (target.protocol === "http:" || target.protocol === "https:")
      && target.origin === accountOrigin
    ) {
      return true;
    }
    return target.protocol === "https:" && LOGIN_NAVIGATION_ORIGINS.has(target.origin);
  } catch {
    return false;
  }
}

function isExactOriginNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    return new URL(targetUrl).origin === normalizeBrowserOrigin(allowedOrigin);
  } catch {
    return false;
  }
}

export function parseRefreshBundle(payload: unknown): RefreshBundle | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const session = asRecord(data?.session);
  const bearer = typeof data?.access_token === "string" ? data.access_token.trim() : "";
  const tokenType = typeof data?.token_type === "string" ? data.token_type.trim() : "";
  const expiresAtSeconds = positiveNumber(data?.access_expires_at);
  const sid = typeof session?.sid === "string" ? session.sid.trim() : "";
  if (root?.success !== true || !bearer || tokenType.toLowerCase() !== "bearer" || !expiresAtSeconds || !sid) {
    return null;
  }
  return { bearer, expiresAt: expiresAtSeconds * 1000, sid };
}

export function extractBrowserUserId(
  payload: unknown,
  platform: LegacyIdentityPlatform = "new_api",
): string | null {
  const root = asRecord(payload);
  if (!root || root.success === false) return null;
  if (platform === "sub2api") return positiveIntegerString(root.id);
  const data = asRecord(root.data) ?? root;
  const user = asRecord(data.user);
  for (const value of [data.id, data.user_id, data.userId, user?.id]) {
    const normalized = positiveIntegerString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeLoginRequest(request: BrowserAccountLoginRequest): BrowserAccountLoginRequest {
  const rawExpectedUserId = request.expectedUserId?.trim();
  const expectedUserId = rawExpectedUserId ? positiveIntegerString(rawExpectedUserId) : null;
  if (rawExpectedUserId && !expectedUserId) {
    throw new Error("目标用户身份无效");
  }
  return {
    accountKey: request.accountKey.trim(),
    browserSessionId: sanitizeOpaqueId(request.browserSessionId),
    browserOrigin: normalizeBrowserOrigin(request.browserOrigin),
    ...(expectedUserId ? { expectedUserId } : {}),
  };
}

function loginRequestAsAccount(request: BrowserAccountLoginRequest): SiteBalanceSession {
  return {
    id: request.accountKey,
    label: "",
    base_url: request.browserOrigin,
    access_token: "",
    auth_kind: "browser_session",
    browser_session_id: request.browserSessionId,
    browser_origin: request.browserOrigin,
    user_id: request.expectedUserId ?? "",
    updated_at: "",
  };
}

function validateBrowserAccount(account: SiteBalanceSession): void {
  if (account.auth_kind !== "browser_session") {
    throw new Error("账号不是浏览器登录类型");
  }
  requireBrowserSessionId(account);
  requireBrowserOrigin(account);
}

function requireBrowserSessionId(account: SiteBalanceSession): string {
  const value = account.browser_session_id?.trim();
  if (!value) throw new Error("浏览器会话引用缺失");
  return sanitizeOpaqueId(value);
}

function requireBrowserOrigin(account: SiteBalanceSession): string {
  const value = account.browser_origin?.trim();
  if (!value) throw new Error("浏览器会话来源缺失");
  return normalizeBrowserOrigin(value);
}

function sanitizeOpaqueId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error("浏览器会话引用无效");
  }
  return normalized;
}

async function readJsonResponse(response: Response): Promise<JsonResponse> {
  const status = typeof response?.status === "number" ? response.status : 0;
  try {
    const text = (await response.text()).trim();
    return { status, payload: text ? JSON.parse(text) as unknown : null };
  } catch {
    return { status, payload: null };
  }
}

async function readJsonResponseWithin(response: Response, timeoutMs: number): Promise<JsonResponse> {
  return settleWithin(
    readJsonResponse(response),
    timeoutMs,
    { status: typeof response?.status === "number" ? response.status : 0, payload: null },
  );
}

async function fetchJson(
  fetchImpl: typeof fetch,
  endpoint: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<JsonResponse> {
  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      credentials: "include",
    }, timeoutMs);
    return readJsonResponseWithin(response, timeoutMs);
  } catch {
    return { status: 0, payload: null };
  }
}

async function fetchWithTimeout(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadWindowUrlWithTimeout(
  browserWindow: BrowserWindow,
  url: string,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browserWindow.loadURL(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          browserWindow.webContents.stop();
          reject(new Error("浏览器页面加载超时"));
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isSidMismatch(value: { kind: string }): value is { kind: "sid_mismatch" } {
  return value.kind === "sid_mismatch";
}

function modernErrorCode(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  for (const value of [root?.code, root?.error_code, error?.code]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isModernAuthPayload(payload: unknown): boolean {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  return Boolean(
    modernErrorCode(payload).startsWith("AUTH_")
    || data?.access_token
    || data?.access_expires_at
    || asRecord(data?.session)?.sid,
  );
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function requestInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function serializePageRequestBody(body: RequestInit["body"]): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("浏览器页面请求暂不支持该请求体类型");
}

function parsePageFetchResult(value: unknown): PageFetchResult | null {
  const root = asRecord(value);
  const status = typeof root?.status === "number" && Number.isInteger(root.status)
    ? root.status
    : 0;
  if (status < 200 || status > 599) return null;
  const statusText = typeof root?.statusText === "string" ? root.statusText : "";
  const body = typeof root?.body === "string" ? root.body : "";
  const headers = Array.isArray(root?.headers)
    ? root.headers.flatMap((entry): Array<[string, string]> => {
        if (!Array.isArray(entry) || entry.length !== 2) return [];
        return typeof entry[0] === "string" && typeof entry[1] === "string"
          ? [[entry[0], entry[1]]]
          : [];
      })
    : [];
  return { status, statusText, body, headers };
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function isSuccessfulHttpStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function positiveIntegerString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const normalized = value.trim().replace(/^0+/, "");
    return normalized || null;
  }
  return null;
}

function parseLegacyIdentityCandidate(value: unknown): LegacyIdentityCandidate | null {
  const record = asRecord(value);
  const platform = record?.platform === "sub2api" ? "sub2api" : "new_api";
  const userId = positiveIntegerString(record?.userId);
  if (!userId) return null;
  const bearer = typeof record?.bearer === "string" ? record.bearer.trim() : "";
  const refreshToken = platform === "sub2api" && typeof record?.refreshToken === "string"
    ? record.refreshToken.trim()
    : "";
  return {
    platform,
    userId,
    ...(bearer ? { bearer } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

function legacyIdentityEndpoint(candidate: LegacyIdentityCandidate | null): string {
  return candidate?.platform === "sub2api" ? "/api/v1/auth/me" : "/api/user/self";
}

function parseSub2ApiRefreshCredentials(
  payload: unknown,
  currentRefreshToken: string,
): { bearer: string; refreshToken: string } | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  for (const candidate of [root, data]) {
    const bearer = typeof candidate?.access_token === "string"
      ? candidate.access_token.trim()
      : "";
    if (!bearer) continue;
    const nextRefreshToken = typeof candidate?.refresh_token === "string"
      ? candidate.refresh_token.trim()
      : "";
    return { bearer, refreshToken: nextRefreshToken || currentRefreshToken };
  }
  return null;
}

function buildLegacyIdentityHeaders(
  candidate: LegacyIdentityCandidate | null,
): Readonly<Record<string, string>> {
  if (!candidate) return {};
  return {
    ...(candidate.bearer ? { Authorization: `Bearer ${candidate.bearer}` } : {}),
    "New-Api-User": candidate.userId,
  };
}

function withAuthoritativeBearer(
  headers: RequestInit["headers"],
  bearer: string,
): Record<string, string> {
  const result = Object.fromEntries(new Headers(headers).entries());
  for (const name of Object.keys(result)) {
    if (name.toLowerCase() === "authorization") delete result[name];
  }
  result.Authorization = `Bearer ${bearer}`;
  return result;
}

function runtimeCandidate(state: RuntimeState): LegacyIdentityCandidate | null {
  if (!state.legacyUserId || !state.legacyPlatform) return null;
  return {
    platform: state.legacyPlatform,
    userId: state.legacyUserId,
    ...(state.legacyBearer ? { bearer: state.legacyBearer } : {}),
    ...(state.legacyRefreshToken ? { refreshToken: state.legacyRefreshToken } : {}),
  };
}

function sameLegacyIdentityCredentials(
  left: LegacyIdentityCandidate | null,
  right: LegacyIdentityCandidate | null,
): boolean {
  return left?.platform === right?.platform
    && left?.userId === right?.userId
    && (left?.bearer ?? "") === (right?.bearer ?? "")
    && (left?.refreshToken ?? "") === (right?.refreshToken ?? "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
