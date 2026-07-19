import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";
import type { SiteBalanceSession } from "../balance/site-balance-sessions.js";
import {
  buildCheckinAccountKey,
  type CheckinTrigger,
  type CheckinVerificationCookieMode,
  type CheckinVerificationResult,
} from "../checkin/types.js";
import {
  buildManagementCookieCandidates,
  type ManagementCookieCandidate,
} from "../services/management-auth.js";

export type CheckinVerificationDiagnosticEventName =
  | "verification_queued"
  | "verification_window_opened"
  | "verification_identity_verified"
  | "verification_completed"
  | "verification_canceled"
  | "verification_timeout";

export interface CheckinVerificationDiagnosticEvent {
  event: CheckinVerificationDiagnosticEventName;
  run_id: string;
  base_url_host: string;
  trigger: CheckinTrigger;
  result_category: string;
  duration_ms: number;
}

export interface OpenCheckinVerificationOptions {
  account: SiteBalanceSession;
  trigger: CheckinTrigger;
  runId: string;
  preferredCookieMode?: CheckinVerificationCookieMode;
}

export interface CheckinVerificationServiceDependencies {
  createSession: (partition: string) => Session;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getParentWindow?: () => BrowserWindow | null;
  windowIcon?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  randomId?: () => string;
  now?: () => number;
  onDiagnostic?: (event: CheckinVerificationDiagnosticEvent) => void;
}

interface VerificationTask {
  key: string;
  options: OpenCheckinVerificationOptions;
  queuedAt: number;
  promise: Promise<CheckinVerificationResult>;
  resolve: (result: CheckinVerificationResult) => void;
  session?: Session;
  window?: BrowserWindow;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setTimeout>;
  identityVerified: boolean;
  cookieMode?: CheckinVerificationCookieMode;
  startupStage?: "session_setup" | "credential_probe" | "window_create" | "page_load";
  failureCategory?: string;
  finished: boolean;
}

interface SelectedCookieCandidate {
  candidate: ManagementCookieCandidate;
  identityVerified: boolean;
  browserUser?: Record<string, unknown>;
}

interface VerificationStatusInspection {
  checkedInToday: boolean;
  reward?: string;
}

interface VerificationFetchResult {
  status: number;
  payload: unknown;
  responseKind: "json" | "other" | "network_error";
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const COOKIE_ATTRIBUTE_NAMES = new Set([
  "domain",
  "expires",
  "httponly",
  "max-age",
  "path",
  "samesite",
  "secure",
]);

export class CheckinVerificationService {
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly randomId: () => string;
  private readonly now: () => number;
  private readonly tasksByAccount = new Map<string, VerificationTask>();
  private readonly queue: VerificationTask[] = [];
  private activeTask: VerificationTask | null = null;

  constructor(private readonly dependencies: CheckinVerificationServiceDependencies) {
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.randomId = dependencies.randomId ?? (() => crypto.randomUUID());
    this.now = dependencies.now ?? (() => Date.now());
  }

  openVerification(options: OpenCheckinVerificationOptions): Promise<CheckinVerificationResult> {
    const baseUrl = normalizeBaseUrl(options.account.base_url);
    const key = buildCheckinAccountKey(baseUrl, options.account.id);
    const existing = this.tasksByAccount.get(key);
    if (existing) {
      if (existing.window && !existing.window.isDestroyed()) {
        existing.window.show();
        existing.window.focus();
      }
      return existing.promise;
    }

    let resolveTask!: (result: CheckinVerificationResult) => void;
    const promise = new Promise<CheckinVerificationResult>((resolve) => {
      resolveTask = resolve;
    });
    const task: VerificationTask = {
      key,
      options: {
        ...options,
        account: { ...options.account, base_url: baseUrl },
      },
      queuedAt: this.now(),
      promise,
      resolve: resolveTask,
      identityVerified: false,
      finished: false,
    };
    this.tasksByAccount.set(key, task);
    this.queue.push(task);
    this.emitDiagnostic("verification_queued", task, "queued");
    this.pumpQueue();
    return promise;
  }

  async cancelAccount(accountKey: string): Promise<void> {
    const task = this.tasksByAccount.get(accountKey);
    if (!task) {
      return;
    }
    await this.completeTask(task, canceledResult(task.options.account.base_url));
  }

  async cancelAll(): Promise<void> {
    const tasks = [...this.tasksByAccount.values()];
    await Promise.all(tasks.map((task) => (
      this.completeTask(task, canceledResult(task.options.account.base_url))
    )));
  }

  private pumpQueue(): void {
    if (this.activeTask) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    if (next.finished) {
      this.pumpQueue();
      return;
    }
    this.activeTask = next;
    void this.startTask(next);
  }

  private async startTask(task: VerificationTask): Promise<void> {
    const { account } = task.options;
    try {
      task.startupStage = "session_setup";
      const partition = `checkin-verification-${this.randomId()}`;
      const verificationSession = this.dependencies.createSession(partition);
      task.session = verificationSession;
      this.configureSessionSecurity(verificationSession);
      task.timeoutTimer = setTimeout(() => {
        void this.completeTask(task, timeoutResult(account.base_url));
      }, this.timeoutMs);

      task.startupStage = "credential_probe";
      const selection = await this.selectCookieCandidate(task, verificationSession);
      if (task.finished) {
        return;
      }
      if (!selection) {
        await this.completeTask(task, {
          status: "account_mismatch",
          success: false,
          message: "保存的后台凭证对应其他账号，请重新保存凭证",
          endpoint: buildStatusEndpoint(account.base_url),
          error_code: "user_id_mismatch",
        });
        return;
      }

      task.identityVerified = selection.identityVerified;
      task.cookieMode = selection.candidate.mode;
      if (task.identityVerified) {
        this.emitDiagnostic("verification_identity_verified", task, "matched");
      }

      task.startupStage = "window_create";
      const browserWindow = this.dependencies.createWindow(
        this.buildWindowOptions(partition),
      );
      task.window = browserWindow;
      this.configureWindowSecurity(task, browserWindow);
      let browserStateReady = false;
      browserWindow.once("ready-to-show", () => {
        if (browserStateReady && !task.finished && !browserWindow.isDestroyed()) {
          browserWindow.show();
          browserWindow.focus();
        }
      });
      browserWindow.once("closed", () => {
        if (!task.finished) {
          void this.completeTask(task, canceledResult(account.base_url));
        }
      });

      task.startupStage = "page_load";
      await browserWindow.loadURL(`${account.base_url}/`);
      if (task.finished) {
        return;
      }
      await browserWindow.webContents.executeJavaScript(
        buildBrowserUserBootstrapScript(
          selection.browserUser
            ?? buildVerificationBrowserUserSnapshot(null, account.user_id),
        ),
      );
      browserStateReady = true;
      await browserWindow.loadURL(buildManualUrl(account.base_url));
      if (task.finished) {
        return;
      }
      await browserWindow.webContents.executeJavaScript(
        buildNativeCheckinTriggerScript(),
        true,
      );
      if (task.finished) {
        return;
      }
      if (!browserWindow.isDestroyed() && !browserWindow.isVisible()) {
        browserWindow.show();
        browserWindow.focus();
      }
      this.emitDiagnostic(
        "verification_window_opened",
        task,
        selection.candidate.mode,
      );
      void this.pollTask(task, selection.candidate.mode);
    } catch {
      const failureCategory = `${task.startupStage ?? "startup"}_failed`;
      task.failureCategory = failureCategory;
      await this.completeTask(task, {
        status: "failed",
        success: false,
        message: task.startupStage === "credential_probe"
          ? "无法初始化人工验证会话，请重新保存后台凭证后再试"
          : "人工验证窗口加载失败，请稍后重试",
        endpoint: buildStatusEndpoint(account.base_url),
        error_code: "access_token_invalid",
      });
    }
  }

  private buildWindowOptions(partition: string): BrowserWindowConstructorOptions {
    const parent = this.dependencies.getParentWindow?.() ?? undefined;
    return {
      title: "CodeDeck 人工签到验证",
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

  private configureSessionSecurity(verificationSession: Session): void {
    verificationSession.setPermissionCheckHandler(() => false);
    verificationSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    verificationSession.on("will-download", (event) => {
      event.preventDefault();
    });
  }

  private configureWindowSecurity(task: VerificationTask, browserWindow: BrowserWindow): void {
    const allowedOrigin = new URL(task.options.account.base_url).origin;
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browserWindow.webContents.on("will-navigate", (event, navigationUrl) => {
      if (!isAllowedVerificationNavigation(navigationUrl, allowedOrigin)) {
        event.preventDefault();
      }
    });
    browserWindow.webContents.on("will-redirect", (event, navigationUrl) => {
      if (!isAllowedVerificationNavigation(navigationUrl, allowedOrigin)) {
        event.preventDefault();
      }
    });
    browserWindow.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
  }

  private async selectCookieCandidate(
    task: VerificationTask,
    verificationSession: Session,
  ): Promise<SelectedCookieCandidate | null> {
    const { account, preferredCookieMode } = task.options;
    const candidates = prioritizeCookieCandidates(
      buildManagementCookieCandidates(account.access_token),
      preferredCookieMode,
    );
    let unknownCandidate: ManagementCookieCandidate | null = null;
    let sawIdentity = false;

    for (const candidate of candidates) {
      if (task.finished) {
        return null;
      }
      await clearSessionCookies(verificationSession);
      try {
        await injectCookieCandidate(verificationSession, account.base_url, candidate);
      } catch {
        continue;
      }
      const response = await fetchIdentity(
        verificationSession,
        account.base_url,
        account.user_id,
      );
      if (task.finished) {
        return null;
      }
      const discoveredUserId = extractVerificationUserId(response.payload);
      if (discoveredUserId === account.user_id) {
        return {
          candidate,
          identityVerified: true,
          browserUser: buildVerificationBrowserUserSnapshot(
            response.payload,
            account.user_id,
          ),
        };
      }
      if (discoveredUserId) {
        sawIdentity = true;
      } else if (
        (candidate.mode === preferredCookieMode || !isCredentialRejected(response))
        && !unknownCandidate
      ) {
        unknownCandidate = candidate;
      }
    }

    if (unknownCandidate) {
      await clearSessionCookies(verificationSession);
      await injectCookieCandidate(verificationSession, account.base_url, unknownCandidate);
      return { candidate: unknownCandidate, identityVerified: false };
    }
    if (sawIdentity) {
      return null;
    }
    throw new Error("No usable cookie candidate");
  }

  private async pollTask(
    task: VerificationTask,
    cookieMode: CheckinVerificationCookieMode,
  ): Promise<void> {
    if (task.finished || !task.session) {
      return;
    }
    const { account } = task.options;
    const [identityResponse, statusResponse] = await Promise.all([
      fetchIdentity(task.session, account.base_url, account.user_id),
      fetchJson(task.session, buildStatusEndpoint(account.base_url), account.user_id),
    ]);
    if (task.finished) {
      return;
    }

    const discoveredUserId = extractVerificationUserId(identityResponse.payload);
    if (discoveredUserId && discoveredUserId !== account.user_id) {
      await this.completeTask(task, {
        status: "account_mismatch",
        success: false,
        message: "验证窗口登录的账号与目标后台账号不一致",
        endpoint: buildStatusEndpoint(account.base_url),
        error_code: "user_id_mismatch",
        verification: { cookie_mode: cookieMode },
      });
      return;
    }
    if (discoveredUserId === account.user_id && !task.identityVerified) {
      task.identityVerified = true;
      this.emitDiagnostic("verification_identity_verified", task, "matched");
    }

    const status = inspectVerificationStatus(statusResponse.payload);
    if (task.identityVerified && status.checkedInToday) {
      await this.completeTask(task, {
        status: "success",
        success: true,
        message: "人工验证并签到完成",
        endpoint: buildStatusEndpoint(account.base_url),
        ...(status.reward ? { reward: status.reward } : {}),
        verification: { cookie_mode: cookieMode },
      });
      return;
    }

    task.pollTimer = setTimeout(() => {
      void this.pollTask(task, cookieMode);
    }, this.pollIntervalMs);
  }

  private async completeTask(
    task: VerificationTask,
    result: CheckinVerificationResult,
  ): Promise<void> {
    if (task.finished) {
      return;
    }
    task.finished = true;
    this.tasksByAccount.delete(task.key);
    const queuedIndex = this.queue.indexOf(task);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
    }
    if (task.timeoutTimer) {
      clearTimeout(task.timeoutTimer);
    }
    if (task.pollTimer) {
      clearTimeout(task.pollTimer);
    }
    if (task.window && !task.window.isDestroyed()) {
      task.window.close();
    }
    if (task.session) {
      try {
        await task.session.clearStorageData();
        await task.session.clearCache();
      } catch {
        // The in-memory partition is discarded even if Chromium is already shutting down.
      }
    }

    const finalResult = !result.verification && task.cookieMode
      ? { ...result, verification: { cookie_mode: task.cookieMode } }
      : result;
    if (finalResult.status === "success" || finalResult.status === "already_checked") {
      this.emitDiagnostic("verification_completed", task, finalResult.status);
    } else if (finalResult.status === "timeout") {
      this.emitDiagnostic("verification_timeout", task, finalResult.status);
    } else {
      this.emitDiagnostic(
        "verification_canceled",
        task,
        finalResult.status === "failed"
          ? task.failureCategory ?? finalResult.status
          : finalResult.status,
      );
    }
    task.resolve(finalResult);
    if (this.activeTask === task) {
      this.activeTask = null;
    }
    this.pumpQueue();
  }

  private emitDiagnostic(
    event: CheckinVerificationDiagnosticEventName,
    task: VerificationTask,
    resultCategory: string,
  ): void {
    try {
      this.dependencies.onDiagnostic?.({
        event,
        run_id: task.options.runId,
        base_url_host: safeUrlHost(task.options.account.base_url),
        trigger: task.options.trigger,
        result_category: resultCategory,
        duration_ms: Math.max(0, this.now() - task.queuedAt),
      });
    } catch {
      // Diagnostics must never change verification behavior.
    }
  }
}

export function isAllowedVerificationNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const target = new URL(targetUrl);
    return (target.protocol === "https:" || target.protocol === "http:")
      && target.origin === allowedOrigin;
  } catch {
    return false;
  }
}

export function parseCookieHeader(headerValue: string): Array<{ name: string; value: string }> {
  const result: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  for (const part of headerValue.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    const normalizedName = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || COOKIE_ATTRIBUTE_NAMES.has(normalizedName)
      || seen.has(name)
    ) {
      continue;
    }
    seen.add(name);
    result.push({ name, value });
  }
  return result;
}

export function extractVerificationUserId(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root || root.success === false) {
    return null;
  }
  const data = asRecord(root.data) ?? root;
  const nestedUser = asRecord(data.user);
  for (const value of [data.id, data.user_id, data.userId, nestedUser?.id]) {
    const normalized = normalizePositiveInteger(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function inspectVerificationStatus(
  payload: unknown,
  date: Date = new Date(),
): VerificationStatusInspection {
  const root = asRecord(payload);
  if (!root || root.success === false) {
    return { checkedInToday: false };
  }
  const data = asRecord(root.data) ?? root;
  const stats = asRecord(data.stats);
  const checkedInToday = readBoolean(stats?.checked_in_today) === true
    || readBoolean(data.checked_in_today) === true;
  if (!checkedInToday) {
    return { checkedInToday: false };
  }
  const reward = extractTodayReward(data, localDateKey(date));
  return {
    checkedInToday: true,
    ...(reward ? { reward } : {}),
  };
}

function prioritizeCookieCandidates(
  candidates: ManagementCookieCandidate[],
  preferredMode: CheckinVerificationCookieMode | undefined,
): ManagementCookieCandidate[] {
  if (!preferredMode) {
    return candidates;
  }
  return [...candidates].sort((left, right) => (
    Number(right.mode === preferredMode) - Number(left.mode === preferredMode)
  ));
}

async function clearSessionCookies(verificationSession: Session): Promise<void> {
  await verificationSession.clearStorageData({ storages: ["cookies"] });
}

async function injectCookieCandidate(
  verificationSession: Session,
  baseUrl: string,
  candidate: ManagementCookieCandidate,
): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const cookies = parseCookieHeader(candidate.headerValue);
  if (cookies.length === 0) {
    throw new Error("Cookie candidate is empty");
  }
  for (const cookie of cookies) {
    await verificationSession.cookies.set({
      url: `${origin}/`,
      name: cookie.name,
      value: cookie.value,
      path: "/",
      secure: origin.startsWith("https://"),
      sameSite: "lax",
    });
  }
}

async function fetchJson(
  verificationSession: Session,
  endpoint: string,
  userId?: string,
): Promise<VerificationFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await verificationSession.fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        ...(userId ? { "New-API-User": userId } : {}),
      },
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = (await response.text()).trim();
    if (!text) {
      return { status: response.status, payload: null, responseKind: "other" };
    }
    try {
      return {
        status: response.status,
        payload: JSON.parse(text) as unknown,
        responseKind: "json",
      };
    } catch {
      return { status: response.status, payload: null, responseKind: "other" };
    }
  } catch {
    return { status: 0, payload: null, responseKind: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIdentity(
  verificationSession: Session,
  baseUrl: string,
  targetUserId: string,
): Promise<VerificationFetchResult> {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/api/user/self`;
  const anonymousHeaderResponse = await fetchJson(verificationSession, endpoint);
  if (extractVerificationUserId(anonymousHeaderResponse.payload)) {
    return anonymousHeaderResponse;
  }
  return fetchJson(verificationSession, endpoint, targetUserId);
}

function isCredentialRejected(response: VerificationFetchResult): boolean {
  if (response.responseKind !== "json") {
    return false;
  }
  const root = asRecord(response.payload);
  const message = [root?.message, root?.msg, root?.error]
    .find((value): value is string => typeof value === "string") ?? "";
  if (/turnstile|cloudflare|captcha|challenge|人机|验证码|校验/i.test(message)) {
    return false;
  }
  return response.status === 401
    || response.status === 403
    || (root?.success === false
      && /unauthorized|forbidden|not logged|未登录|鉴权|无权限/i.test(message));
}

function extractTodayReward(data: Record<string, unknown>, today: string): string | undefined {
  const direct = readReward(data);
  if (direct) {
    return direct;
  }
  for (const key of ["checkin_history", "checkins", "records", "history"] as const) {
    const collection = data[key];
    if (Array.isArray(collection)) {
      const record = collection.find((item) => {
        const candidate = asRecord(item);
        const dateValue = candidate?.date ?? candidate?.checkin_date ?? candidate?.created_at;
        return typeof dateValue === "string" && dateValue.slice(0, 10) === today;
      });
      const reward = readReward(asRecord(record));
      if (reward) {
        return reward;
      }
      continue;
    }
    const record = asRecord(collection);
    if (!record) {
      continue;
    }
    const todayValue = record[today];
    const reward = readReward(asRecord(todayValue)) ?? primitiveReward(todayValue);
    if (reward) {
      return reward;
    }
  }
  return undefined;
}

function readReward(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of ["reward", "amount", "quota", "quota_awarded"] as const) {
    const reward = primitiveReward(record[key]);
    if (reward) {
      return reward;
    }
  }
  return undefined;
}

function primitiveReward(value: unknown): string | undefined {
  return (typeof value === "string" || typeof value === "number") && String(value).trim()
    ? String(value).trim()
    : undefined;
}

function normalizePositiveInteger(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number(value) > 0) {
    return value.trim();
  }
  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Verification URL must use HTTP or HTTPS");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function buildManualUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/console/personal`;
}

function buildBrowserUserBootstrapScript(browserUser: Record<string, unknown>): string {
  const serializedUser = JSON.stringify(browserUser);
  return `window.localStorage.setItem("user", ${JSON.stringify(serializedUser)});`;
}

export function buildNativeCheckinTriggerScript(timeoutMs: number = 6_000): string {
  return `new Promise((resolve) => {
    let observer = null;
    let timer = 0;
    const finish = (result) => {
      if (timer) window.clearTimeout(timer);
      if (observer) observer.disconnect();
      resolve(result);
    };
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && element.getClientRects().length > 0;
    };
    const attempt = () => {
      const target = Array.from(document.querySelectorAll("button,[role='button']"))
        .find((element) => {
          const label = (element.textContent || "").replace(/\\s+/g, "");
          const isCheckinEntry = label === "立即签到"
            || label === "签到"
            || /^(checkin|checkinnow|signinnow)$/i.test(label);
          return isCheckinEntry
            && !element.disabled
            && element.getAttribute("aria-disabled") !== "true"
            && isVisible(element);
      });
      if (!target) return false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      target.click();
      window.setTimeout(() => finish("clicked"), 250);
      return true;
    };
    if (attempt()) return;
    observer = new MutationObserver(() => attempt());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "class"],
    });
    timer = window.setTimeout(() => finish("not_found"), ${Math.max(0, timeoutMs)});
  });`;
}

export function buildVerificationBrowserUserSnapshot(
  payload: unknown,
  targetUserId: string,
): Record<string, unknown> {
  const root = asRecord(payload);
  const source = asRecord(root?.data) ?? {};
  const sanitized = sanitizeBrowserStateRecord(source);
  const numericUserId = Number(targetUserId);
  sanitized.id = Number.isSafeInteger(numericUserId) && numericUserId > 0
    ? numericUserId
    : targetUserId;
  sanitized.username = typeof sanitized.username === "string" ? sanitized.username : "";
  sanitized.display_name = typeof sanitized.display_name === "string"
    ? sanitized.display_name
    : sanitized.username;
  const numericRole = Number(sanitized.role);
  sanitized.role = Number.isFinite(numericRole) ? numericRole : 1;
  const numericStatus = Number(sanitized.status);
  sanitized.status = Number.isFinite(numericStatus) ? numericStatus : 1;
  return sanitized;
}

function sanitizeBrowserStateRecord(
  source: Record<string, unknown>,
  depth: number = 0,
): Record<string, unknown> {
  if (depth > 5) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/(?:^|_)(?:access_?token|token|secret|password|cookie|session|verification_?code|api_?key)(?:$|_)/i.test(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        const record = asRecord(item);
        return record ? sanitizeBrowserStateRecord(record, depth + 1) : item;
      });
      continue;
    }
    const record = asRecord(value);
    result[key] = record ? sanitizeBrowserStateRecord(record, depth + 1) : value;
  }
  return result;
}

function buildStatusEndpoint(baseUrl: string, date: Date = new Date()): string {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `${normalizeBaseUrl(baseUrl)}/api/user/checkin?month=${month}`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function canceledResult(baseUrl: string): CheckinVerificationResult {
  return {
    status: "canceled",
    success: false,
    message: "已取消人工验证",
    endpoint: buildStatusEndpoint(baseUrl),
    error_code: "turnstile_required",
  };
}

function timeoutResult(baseUrl: string): CheckinVerificationResult {
  return {
    status: "timeout",
    success: false,
    message: "人工验证已超时，可重新打开验证窗口",
    endpoint: buildStatusEndpoint(baseUrl),
    error_code: "turnstile_required",
  };
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-host";
  }
}
