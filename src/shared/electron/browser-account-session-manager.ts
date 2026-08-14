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
  getParentWindow?: () => BrowserWindow | null;
  windowIcon?: string;
  randomId?: () => string;
  now?: () => number;
  loginTimeoutMs?: number;
  pollIntervalMs?: number;
  onStatusChange?: (snapshot: BrowserAccountStatusSnapshot) => void;
}

interface RuntimeState {
  mode: BrowserAccountAuthMode;
  status: BrowserAccountAuthStatus;
  bearer?: string;
  bearerExpiresAt?: number;
  sid?: string;
  generation: number;
}

interface RefreshBundle {
  bearer: string;
  expiresAt: number;
  sid: string;
}

interface LoginTask {
  request: BrowserAccountLoginRequest;
  promise: Promise<BrowserAccountLoginResult>;
  resolve: (result: BrowserAccountLoginResult) => void;
  window?: BrowserWindow;
  pollTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  finished: boolean;
}

interface JsonResponse {
  status: number;
  payload: unknown;
}

const PARTITION_PREFIX = "persist:codedeck-newapi-";
const LOGIN_NAVIGATION_ORIGINS = new Set([
  "https://connect.linux.do",
  "https://linux.do",
]);
const REFRESH_SKEW_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_200;

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
  private readonly sessions = new Map<string, Session>();
  private readonly configuredSessions = new WeakSet<Session>();
  private readonly loginTasks = new Map<string, LoginTask>();
  private readonly loginQueue: LoginTask[] = [];
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
    const tasks = [...this.loginTasks.values()];
    await Promise.all(tasks.map((task) => this.completeLogin(task, {
      status: "canceled",
      message: "应用正在退出",
    })));
    this.refreshes.clear();
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
    const refresh = this.refreshOrDetect(accountKey, account, generation)
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
      this.emitStatus(accountKey);
      return this.buildModernContext(accountKey, account, result.bundle.bearer);
    }
    if (result.kind === "legacy") {
      state.mode = "legacy";
      state.status = "ready";
      state.bearer = undefined;
      state.bearerExpiresAt = undefined;
      state.sid = undefined;
      this.emitStatus(accountKey);
      return this.buildLegacyContext(accountKey, account);
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
      response = await browserSession.fetch(`${origin}/api/user/auth/refresh`, {
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
      });
    } catch {
      return { kind: "error", message: "浏览器登录状态检查失败，请稍后重试" };
    }
    const payload = await readJsonResponse(response);
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
    return {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        const response = await boundFetch(input, init);
        if (response.status !== 401 && response.status !== 403) {
          return response;
        }
        const state = this.ensureState(accountKey);
        if (state.bearer !== bearer) {
          return response;
        }
        state.bearer = undefined;
        state.bearerExpiresAt = undefined;
        const refreshed = await this.resolveRequestContext(accountKey, account, true);
        if (refreshed.authMode !== "browser_bearer") {
          this.clearTransientState(accountKey, "login_required");
          throw new BrowserLoginRequiredError();
        }
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.delete("Authorization");
        for (const [name, value] of Object.entries(refreshed.headers)) {
          retryHeaders.set(name, value);
        }
        const retryResponse = await boundFetch(input, {
          ...init,
          headers: retryHeaders,
        });
        if (retryResponse.status === 401 || retryResponse.status === 403) {
          this.clearTransientState(accountKey, "login_required");
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
  ): ManagementRequestContext {
    const boundFetch = this.buildBoundFetch(account);
    return {
      fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        const response = await boundFetch(input, init);
        if (response.status === 401 || response.status === 403) {
          this.clearTransientState(accountKey, "login_required");
        }
        return response;
      }) as typeof fetch,
      headers: {},
      userIdHeaderPolicy: "legacy_if_required",
      authMode: "browser_cookie",
    };
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
      task.timeoutTimer = setTimeout(() => {
        void this.completeLogin(task, { status: "failed", message: "浏览器登录已超时" });
      }, this.dependencies.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS);
      browserWindow.show();
      browserWindow.focus();
      await browserWindow.loadURL(task.request.browserOrigin);
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
      autoHideMenuBar: true,
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
    browserWindow.on("closed", () => {
      if (!task.finished) {
        void this.completeLogin(task, { status: "canceled", message: "已取消浏览器登录" });
      }
    });
  }

  private async pollLogin(task: LoginTask): Promise<void> {
    if (task.finished) return;
    const state = this.ensureState(task.request.accountKey);
    if (state.status === "login_required") {
      state.status = "authenticating";
    }
    const account = loginRequestAsAccount(task.request);
    try {
      const context = await this.resolveRequestContext(task.request.accountKey, account, true);
      if (task.finished) return;
      const legacyIdentityCandidate = context.authMode === "browser_cookie"
        ? await this.readLegacyIdentityCandidate(task)
        : null;
      if (task.finished) return;
      const response = await fetchJson(
        context.fetch,
        `${task.request.browserOrigin}/api/user/self`,
        legacyIdentityCandidate
          ? { ...context.headers, "New-Api-User": legacyIdentityCandidate }
          : context.headers,
      );
      if (task.finished) return;
      const userId = extractBrowserUserId(response.payload);
      if (userId) {
        if (
          (legacyIdentityCandidate && legacyIdentityCandidate !== userId)
          || (task.request.expectedUserId && task.request.expectedUserId !== userId)
        ) {
          await this.completeLogin(task, {
            status: "account_mismatch",
            message: "浏览器中登录的账号与目标账号不一致",
          });
          return;
        }
        await this.getSession(task.request.browserSessionId).cookies.flushStore();
        if (task.finished) return;
        this.setStatus(task.request.accountKey, "ready");
        await this.completeLogin(task, { status: "ready", userId, message: "浏览器登录成功" });
        return;
      }
    } catch (error) {
      if (!(error instanceof BrowserLoginRequiredError)) {
        // Temporary protocol/network failures remain retryable while the user is interacting.
      }
    }
    if (task.finished) return;
    task.pollTimer = setTimeout(() => {
      void this.pollLogin(task);
    }, this.dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  private async readLegacyIdentityCandidate(task: LoginTask): Promise<string | null> {
    const expectedUserId = positiveIntegerString(task.request.expectedUserId);
    if (expectedUserId) {
      return expectedUserId;
    }
    const browserWindow = task.window;
    if (!browserWindow || browserWindow.isDestroyed()) {
      return null;
    }
    try {
      const currentUrl = browserWindow.webContents.getURL();
      if (new URL(currentUrl).origin !== task.request.browserOrigin) {
        return null;
      }
      const expectedOrigin = JSON.stringify(task.request.browserOrigin);
      const value = await browserWindow.webContents.executeJavaScript(
        `window.location.origin === ${expectedOrigin} ? window.localStorage.getItem("uid") : null`,
        true,
      ) as unknown;
      return positiveIntegerString(value);
    } catch {
      return null;
    }
  }

  private async completeLogin(task: LoginTask, result: BrowserAccountLoginResult): Promise<void> {
    if (task.finished) return;
    task.finished = true;
    if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
    if (task.pollTimer) clearTimeout(task.pollTimer);
    this.loginTasks.delete(task.request.accountKey);
    const queuedIndex = this.loginQueue.indexOf(task);
    if (queuedIndex >= 0) this.loginQueue.splice(queuedIndex, 1);
    if (task.window && !task.window.isDestroyed()) task.window.close();
    if (result.status !== "ready") {
      this.setStatus(task.request.accountKey, "login_required");
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
    this.emitStatus(accountKey);
  }

  private async resetAccountRuntime(
    accountKey: string,
    status: BrowserAccountAuthStatus,
  ): Promise<void> {
    const state = this.ensureState(accountKey);
    state.generation += 1;
    this.refreshes.delete(accountKey);
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

export function extractBrowserUserId(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root || root.success === false) return null;
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
  try {
    const text = (await response.text()).trim();
    return { status: response.status, payload: text ? JSON.parse(text) as unknown : null };
  } catch {
    return { status: response.status, payload: null };
  }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  endpoint: string,
  headers: Readonly<Record<string, string>>,
): Promise<JsonResponse> {
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      credentials: "include",
    });
    return readJsonResponse(response);
  } catch {
    return { status: 0, payload: null };
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

function positiveIntegerString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const normalized = value.trim().replace(/^0+/, "");
    return normalized || null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
