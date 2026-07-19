import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";
import { describe, expect, it, vi } from "vitest";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";
import {
  CheckinVerificationService,
  buildNativeCheckinTriggerScript,
  buildVerificationBrowserUserSnapshot,
  extractVerificationUserId,
  inspectVerificationStatus,
  isAllowedVerificationNavigation,
  parseCookieHeader,
  type CheckinVerificationDiagnosticEvent,
} from "../../electron/checkin-verification-service.js";

function makeAccount(overrides: Partial<SiteBalanceSession> = {}): SiteBalanceSession {
  return {
    id: "account-a",
    label: "账号1",
    base_url: "https://new-api.example.com",
    access_token: "session-value",
    user_id: "42",
    auto_checkin_enabled: true,
    updated_at: "",
    ...overrides,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonErrorResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeSession {
  readonly cookieWrites: Electron.CookiesSetDetails[] = [];
  readonly storageClears: Array<Electron.ClearStorageDataOptions | undefined> = [];
  readonly permissionHandlers = new Map<string, unknown>();
  readonly cookies = {
    set: vi.fn(async (details: Electron.CookiesSetDetails) => {
      this.cookieWrites.push(details);
    }),
  };
  readonly clearStorageData = vi.fn(async (options?: Electron.ClearStorageDataOptions) => {
    this.storageClears.push(options);
  });
  readonly clearCache = vi.fn(async () => undefined);
  readonly setPermissionCheckHandler = vi.fn((handler: unknown) => {
    this.permissionHandlers.set("check", handler);
  });
  readonly setPermissionRequestHandler = vi.fn((handler: unknown) => {
    this.permissionHandlers.set("request", handler);
  });
  readonly on = vi.fn((event: string, handler: unknown) => {
    this.permissionHandlers.set(event, handler);
    return this;
  });
  readonly fetch: ReturnType<typeof vi.fn>;

  constructor(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>) {
    this.fetch = vi.fn(fetchImpl);
  }

  asElectronSession(): Session {
    return this as unknown as Session;
  }
}

class FakeWindow {
  readonly onceHandlers = new Map<string, () => void>();
  readonly webContentsHandlers = new Map<string, unknown>();
  readonly executedScripts: string[] = [];
  readonly webContents = {
    setWindowOpenHandler: vi.fn((handler: unknown) => {
      this.webContentsHandlers.set("window-open", handler);
    }),
    on: vi.fn((event: string, handler: unknown) => {
      this.webContentsHandlers.set(event, handler);
      return this.webContents;
    }),
    executeJavaScript: vi.fn(async (script: string) => {
      this.executedScripts.push(script);
    }),
  };
  readonly show = vi.fn(() => {
    this.visible = true;
  });
  readonly focus = vi.fn();
  readonly loadURL = vi.fn(async (url: string) => {
    this.loadedUrl = url;
    this.onceHandlers.get("ready-to-show")?.();
  });
  visible = false;
  destroyed = false;
  loadedUrl = "";

  readonly once = vi.fn((event: string, handler: () => void) => {
    this.onceHandlers.set(event, handler);
    return this;
  });

  readonly close = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onceHandlers.get("closed")?.();
  });

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  asBrowserWindow(): BrowserWindow {
    return this as unknown as BrowserWindow;
  }
}

describe("check-in verification helpers", () => {
  it("clicks only the native check-in entry and leaves CAPTCHA controls alone", () => {
    const script = buildNativeCheckinTriggerScript(2_000);

    expect(script).toContain("button,[role='button']");
    expect(script).toContain("立即签到");
    expect(script).toContain("target.click()");
    expect(script).toContain("2000");
    expect(script).not.toContain("验证码");
    expect(script).not.toContain("确认");
    expect(script).not.toContain("querySelectorAll(\"input");
  });

  it("keeps the verified user shape while removing browser-state secrets", () => {
    expect(buildVerificationBrowserUserSnapshot({
      success: true,
      data: {
        id: 42,
        username: "alice",
        display_name: "Alice",
        role: 2,
        status: 1,
        group: "default",
        setting: "{}",
        access_token: "sensitive-access-token",
        nested: {
          session_id: "sensitive-session",
          preference: "compact",
        },
      },
    }, "42")).toEqual({
      id: 42,
      username: "alice",
      display_name: "Alice",
      role: 2,
      status: 1,
      group: "default",
      setting: "{}",
      nested: { preference: "compact" },
    });
  });

  it("parses real cookie pairs without persisting cookie attributes", () => {
    expect(parseCookieHeader(
      "session=abc==; theme=dark; Path=/; HttpOnly; Secure; SameSite=Lax",
    )).toEqual([
      { name: "session", value: "abc==" },
      { name: "theme", value: "dark" },
    ]);
  });

  it("allows only same-origin HTTP(S) top-level navigation", () => {
    const origin = "https://new-api.example.com";
    expect(isAllowedVerificationNavigation(
      "https://new-api.example.com/console/personal",
      origin,
    )).toBe(true);
    expect(isAllowedVerificationNavigation("https://login.example.net/oauth", origin)).toBe(false);
    expect(isAllowedVerificationNavigation("javascript:alert(1)", origin)).toBe(false);
  });

  it("extracts identity and today's reward from supported response shapes", () => {
    expect(extractVerificationUserId({ success: true, data: { user: { id: 42 } } })).toBe("42");
    expect(inspectVerificationStatus({
      success: true,
      data: {
        stats: { checked_in_today: true },
        checkin_history: { "2026-07-15": { quota_awarded: 18 } },
      },
    }, new Date(2026, 6, 15))).toEqual({ checkedInToday: true, reward: "18" });
  });
});

describe("CheckinVerificationService", () => {
  it("uses an isolated memory partition, injects the matching cookie, and cleans up on success", async () => {
    const sessions: FakeSession[] = [];
    const windows: FakeWindow[] = [];
    const windowOptions: BrowserWindowConstructorOptions[] = [];
    const diagnostics: CheckinVerificationDiagnosticEvent[] = [];
    const service = new CheckinVerificationService({
      createSession: () => {
        const fake = new FakeSession(async (input) => (
          input.includes("/api/user/self")
            ? jsonResponse({ success: true, data: { id: 42 } })
            : jsonResponse({
                success: true,
                data: {
                  stats: { checked_in_today: true },
                  checkin_history: { "2026-07-15": 9 },
                },
              })
        ));
        sessions.push(fake);
        return fake.asElectronSession();
      },
      createWindow: (options) => {
        windowOptions.push(options);
        const fake = new FakeWindow();
        windows.push(fake);
        return fake.asBrowserWindow();
      },
      pollIntervalMs: 1,
      timeoutMs: 1_000,
      randomId: () => "random-partition",
      onDiagnostic: (event) => diagnostics.push(event),
    });

    const result = await service.openVerification({
      account: makeAccount(),
      trigger: "manual",
      runId: "run-1",
      preferredCookieMode: "session_wrapped",
    });

    expect(result).toMatchObject({ status: "success", success: true });
    expect(windowOptions[0].webPreferences).toMatchObject({
      partition: "checkin-verification-random-partition",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(windowOptions[0].webPreferences).not.toHaveProperty("preload");
    expect(String(windowOptions[0].webPreferences?.partition)).not.toMatch(/^persist:/);
    expect(sessions[0].cookieWrites).toContainEqual(expect.objectContaining({
      name: "session",
      value: "session-value",
    }));
    const selfRequests = sessions[0].fetch.mock.calls.filter((call) => (
      String(call[0]).includes("/api/user/self")
    ));
    const statusRequests = sessions[0].fetch.mock.calls.filter((call) => (
      String(call[0]).includes("/api/user/checkin?month=")
    ));
    expect(selfRequests.every((call) => (
      !("New-API-User" in ((call[1] as RequestInit).headers as Record<string, string>))
    ))).toBe(true);
    expect(statusRequests.some((call) => (
      ((call[1] as RequestInit).headers as Record<string, string>)["New-API-User"] === "42"
    ))).toBe(true);
    expect(sessions[0].permissionHandlers.has("check")).toBe(true);
    expect(sessions[0].permissionHandlers.has("request")).toBe(true);
    expect(sessions[0].permissionHandlers.has("will-download")).toBe(true);
    expect(windows[0].webContentsHandlers.has("will-navigate")).toBe(true);
    expect(windows[0].webContentsHandlers.has("will-redirect")).toBe(true);
    expect(windows[0].webContentsHandlers.has("window-open")).toBe(true);
    expect(windows[0].loadedUrl).toBe("https://new-api.example.com/console/personal");
    expect(windows[0].loadURL.mock.calls.map((call) => call[0])).toEqual([
      "https://new-api.example.com/",
      "https://new-api.example.com/console/personal",
    ]);
    expect(windows[0].executedScripts[0]).toBe(
      'window.localStorage.setItem("user", "{\\"id\\":42,\\"username\\":\\"\\",\\"display_name\\":\\"\\",\\"role\\":1,\\"status\\":1}");',
    );
    expect(windows[0].executedScripts[1]).toContain("立即签到");
    expect(windows[0].executedScripts[1]).toContain("target.click()");
    expect(windows[0].executedScripts[0]).not.toContain("session-value");
    expect(windows[0].executedScripts[0]).not.toContain("token");
    expect(windows[0].close).toHaveBeenCalledOnce();
    expect(sessions[0].storageClears.some((value) => value === undefined)).toBe(true);
    expect(sessions[0].clearCache).toHaveBeenCalledOnce();
    expect(diagnostics.map((event) => event.event)).toEqual(expect.arrayContaining([
      "verification_queued",
      "verification_window_opened",
      "verification_identity_verified",
      "verification_completed",
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain("session-value");
    expect(JSON.stringify(result)).not.toContain("session-value");
    expect(JSON.stringify(result)).not.toContain('"42"');
  });

  it("deduplicates one account and queues different accounts serially", async () => {
    const partitions: string[] = [];
    const windows: FakeWindow[] = [];
    const service = new CheckinVerificationService({
      createSession: (partition) => {
        partitions.push(partition);
        return new FakeSession(async (input) => (
          input.includes("/api/user/self")
            ? jsonResponse({ success: true, data: { id: input.includes("two.example") ? 84 : 42 } })
            : jsonResponse({ success: true, data: { stats: { checked_in_today: false } } })
        )).asElectronSession();
      },
      createWindow: () => {
        const fake = new FakeWindow();
        windows.push(fake);
        return fake.asBrowserWindow();
      },
      timeoutMs: 1_000,
      pollIntervalMs: 100,
      randomId: () => `partition-${partitions.length + 1}`,
    });
    const firstOptions = {
      account: makeAccount(),
      trigger: "manual" as const,
      runId: "run-1",
    };
    const first = service.openVerification(firstOptions);
    const duplicate = service.openVerification(firstOptions);
    const second = service.openVerification({
      account: makeAccount({
        id: "account-b",
        base_url: "https://two.example.com",
        user_id: "84",
      }),
      trigger: "automatic",
      runId: "run-2",
    });

    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(windows).toHaveLength(1));
    windows[0].close();
    await expect(first).resolves.toMatchObject({ status: "canceled" });
    await vi.waitFor(() => expect(windows).toHaveLength(2));
    windows[1].close();
    await expect(second).resolves.toMatchObject({ status: "canceled" });
    expect(partitions).toHaveLength(2);
    expect(new Set(partitions).size).toBe(2);
  });

  it("rejects an authenticated different account before opening a window", async () => {
    const createWindow = vi.fn();
    const service = new CheckinVerificationService({
      createSession: () => new FakeSession(async () => (
        jsonResponse({ success: true, data: { id: 99 } })
      )).asElectronSession(),
      createWindow,
      timeoutMs: 1_000,
    });

    await expect(service.openVerification({
      account: makeAccount(),
      trigger: "manual",
      runId: "run-mismatch",
    })).resolves.toMatchObject({
      status: "account_mismatch",
      error_code: "user_id_mismatch",
    });
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("reports an expired saved session instead of opening an unusable window", async () => {
    const createWindow = vi.fn();
    const service = new CheckinVerificationService({
      createSession: () => new FakeSession(async () => (
        jsonErrorResponse({ success: false, message: "not logged in" }, 401)
      )).asElectronSession(),
      createWindow,
      timeoutMs: 1_000,
    });

    await expect(service.openVerification({
      account: makeAccount(),
      trigger: "manual",
      runId: "run-expired",
    })).resolves.toMatchObject({
      status: "failed",
      error_code: "access_token_invalid",
    });
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("opens with a confirmed Cookie mode when identity lookup requires the user header", async () => {
    const windows: FakeWindow[] = [];
    const service = new CheckinVerificationService({
      createSession: () => new FakeSession(async (input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (input.includes("/api/user/self")) {
          return headers["New-API-User"] === "42"
            ? jsonResponse({ success: true, data: { id: 42 } })
            : jsonErrorResponse({ success: false, message: "not logged in" }, 401);
        }
        return jsonResponse({
          success: true,
          data: { stats: { checked_in_today: true } },
        });
      }).asElectronSession(),
      createWindow: () => {
        const fake = new FakeWindow();
        windows.push(fake);
        return fake.asBrowserWindow();
      },
      timeoutMs: 1_000,
      pollIntervalMs: 1,
    });

    await expect(service.openVerification({
      account: makeAccount(),
      trigger: "manual",
      runId: "run-header-fallback",
      preferredCookieMode: "session_wrapped",
    })).resolves.toMatchObject({ status: "success" });
    expect(windows).toHaveLength(1);
    expect(windows[0].loadedUrl).toBe("https://new-api.example.com/console/personal");
  });

  it("times out and clears the in-memory session even while credential probing is pending", async () => {
    const fakeSession = new FakeSession(() => new Promise<Response>(() => undefined));
    const service = new CheckinVerificationService({
      createSession: () => fakeSession.asElectronSession(),
      createWindow: vi.fn(),
      timeoutMs: 10,
    });

    await expect(service.openVerification({
      account: makeAccount(),
      trigger: "automatic",
      runId: "run-timeout",
    })).resolves.toMatchObject({ status: "timeout" });
    expect(fakeSession.storageClears.some((value) => value === undefined)).toBe(true);
    expect(fakeSession.clearCache).toHaveBeenCalledOnce();
  });
});
