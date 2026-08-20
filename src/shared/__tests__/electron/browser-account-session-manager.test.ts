import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, Session } from "electron";
import {
  BrowserAccountSessionManager,
  BrowserLoginRequiredError,
  browserPartitionName,
  isAllowedBrowserNavigation,
  parseRefreshBundle,
} from "../../electron/browser-account-session-manager.js";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function browserAccount(): SiteBalanceSession {
  return {
    id: "account-1",
    label: "账号1",
    base_url: "https://panel.example.com",
    access_token: "",
    auth_kind: "browser_session",
    browser_session_id: "opaque-1",
    browser_slot: 1,
    browser_origin: "https://panel.example.com",
    user_id: "42",
    updated_at: "2026-08-10T00:00:00.000Z",
  };
}

function createSessionMock(fetchMock: ReturnType<typeof vi.fn>): Session {
  return {
    fetch: fetchMock,
    cookies: { flushStore: vi.fn(async () => undefined) },
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
  } as unknown as Session;
}

function createManager(session: Session, now: () => number = () => Date.now()) {
  return new BrowserAccountSessionManager({
    createSession: vi.fn(() => session),
    createWindow: vi.fn(() => ({} as BrowserWindow)),
    randomId: () => "opaque-generated",
    now,
  });
}

function createLoginWindowMock(options: {
  currentUrl?: string;
  localStorageUser?: string;
  localStorageUid?: unknown;
  localStorageAuthUser?: string;
  localStorageAuthToken?: string;
  localStorageRefreshToken?: string;
  pageFetchResults?: Array<{
    status: number;
    statusText?: string;
    headers?: Array<[string, string]>;
    body: string;
  } | null>;
  loadURL?: () => Promise<void>;
} = {}): BrowserWindow {
  const windowListeners = new Map<string, (event?: { preventDefault: () => void }) => void>();
  let destroyed = false;
  const browserWindow = {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      stop: vi.fn(),
      getURL: vi.fn(() => options.currentUrl ?? "https://panel.example.com/oauth/callback"),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes("window.fetch(request.url")) {
          return options.pageFetchResults?.shift() ?? null;
        }
        const currentUrl = options.currentUrl ?? "https://panel.example.com/oauth/callback";
        const localStorageValues = new Map<string, string>();
        if (options.localStorageUser !== undefined) {
          localStorageValues.set("user", options.localStorageUser);
        }
        if (options.localStorageUid !== undefined && options.localStorageUid !== null) {
          localStorageValues.set("uid", String(options.localStorageUid));
        }
        if (options.localStorageAuthUser !== undefined) {
          localStorageValues.set("auth_user", options.localStorageAuthUser);
        }
        if (options.localStorageAuthToken !== undefined) {
          localStorageValues.set("auth_token", options.localStorageAuthToken);
        }
        if (options.localStorageRefreshToken !== undefined) {
          localStorageValues.set("refresh_token", options.localStorageRefreshToken);
        }
        const execute = new Function("window", `return (${script});`) as (
          windowValue: {
            location: { origin: string };
            localStorage: { getItem: (key: string) => string | null };
          },
        ) => unknown;
        return execute({
          location: { origin: new URL(currentUrl).origin },
          localStorage: {
            getItem: (key: string) => localStorageValues.get(key) ?? null,
          },
        });
      }),
    },
    loadURL: vi.fn(options.loadURL ?? (async () => undefined)),
    on: vi.fn((event: string, listener: (event?: { preventDefault: () => void }) => void) => {
      windowListeners.set(event, listener);
    }),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(() => {
      let prevented = false;
      windowListeners.get("close")?.({
        preventDefault: () => {
          prevented = true;
        },
      });
      if (prevented) {
        return;
      }
      destroyed = true;
      windowListeners.get("closed")?.();
    }),
    isDestroyed: vi.fn(() => destroyed),
  } as unknown as BrowserWindow;
  return browserWindow;
}

describe("BrowserAccountSessionManager", () => {
  it("uses stable opaque persistent partitions and exact-origin navigation", () => {
    expect(browserPartitionName("opaque-1")).toBe("persist:codedeck-newapi-opaque-1");
    expect(isAllowedBrowserNavigation(
      "https://panel.example.com/console/personal",
      "https://panel.example.com",
    )).toBe(true);
    expect(isAllowedBrowserNavigation(
      "https://connect.linux.do/oauth2/authorize",
      "https://panel.example.com",
    )).toBe(true);
    expect(isAllowedBrowserNavigation(
      "https://linux.do/session/sso",
      "https://panel.example.com",
    )).toBe(true);
    expect(isAllowedBrowserNavigation(
      "http://connect.linux.do/oauth2/authorize",
      "https://panel.example.com",
    )).toBe(false);
    expect(isAllowedBrowserNavigation(
      "https://evil.example.com/oauth",
      "https://panel.example.com",
    )).toBe(false);
    expect(isAllowedBrowserNavigation(
      "https://subdomain.linux.do/oauth",
      "https://panel.example.com",
    )).toBe(false);
  });

  it("keeps different CodeDeck accounts in distinct persistent partitions", () => {
    expect(browserPartitionName("account-a-local-ref"))
      .not.toBe(browserPartitionName("account-b-local-ref"));
  });

  it("parses only the pinned rc.22 AuthBundle shape", () => {
    expect(parseRefreshBundle({
      success: true,
      data: {
        access_token: "memory-bearer",
        token_type: "Bearer",
        access_expires_at: 1_800_000_000,
        session: { sid: "sid-1" },
      },
    })).toEqual({
      bearer: "memory-bearer",
      expiresAt: 1_800_000_000_000,
      sid: "sid-1",
    });
    expect(parseRefreshBundle({ success: true, data: { access_token: "too-loose" } })).toBeNull();
  });

  it("serializes refreshes and keeps Bearer/SID in runtime context only", async () => {
    const fetchMock = vi.fn(async (
      _input?: Parameters<typeof fetch>[0],
      _init?: RequestInit,
    ) => response(200, {
      success: true,
      data: {
        access_token: "memory-bearer",
        token_type: "Bearer",
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
        session: { sid: "sid-1" },
      },
    }));
    const session = createSessionMock(fetchMock);
    const manager = createManager(session);

    const [left, right] = await Promise.all([
      manager.getRequestContext("account-key", browserAccount()),
      manager.getRequestContext("account-key", browserAccount()),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      redirect: "manual",
    }));
    expect(left.headers).toEqual({ Authorization: "Bearer memory-bearer" });
    expect(right.authMode).toBe("browser_bearer");
    expect(session.cookies.flushStore).toHaveBeenCalledTimes(1);
  });

  it("omits SID on cold start and retries one confirmed mismatch without SID", async () => {
    let now = 1_700_000_000_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: {
          access_token: "bearer-a",
          token_type: "Bearer",
          access_expires_at: Math.floor(now / 1000) + 31,
          session: { sid: "sid-a" },
        },
      }))
      .mockResolvedValueOnce(response(409, {
        success: false,
        code: "AUTH_SESSION_MISMATCH",
      }))
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: {
          access_token: "bearer-b",
          token_type: "Bearer",
          access_expires_at: Math.floor(now / 1000) + 900,
          session: { sid: "sid-b" },
        },
      }));
    const manager = createManager(createSessionMock(fetchMock), () => now);
    await manager.getRequestContext("account-key", browserAccount());
    now += 2_000;
    await manager.getRequestContext("account-key", browserAccount());

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const mismatchHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
    expect(firstHeaders["X-Auth-Session"]).toBeUndefined();
    expect(mismatchHeaders["X-Auth-Session"]).toBe("sid-a");
    expect(retryHeaders["X-Auth-Session"]).toBeUndefined();
  });

  it("uses partition-owned cookies for legacy fetch without synthesizing Cookie", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const manager = createManager(createSessionMock(fetchMock));
    const context = await manager.getRequestContext("account-key", browserAccount());
    await context.fetch("https://panel.example.com/api/user/self", {
      headers: { Accept: "application/json" },
    });

    expect(context.authMode).toBe("browser_cookie");
    expect(context.headers).toEqual({ "New-Api-User": "42" });
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({
      credentials: "include",
      redirect: "manual",
    }));
    expect(fetchMock.mock.calls[2][1]?.headers).not.toEqual(expect.objectContaining({ Cookie: expect.anything() }));
  });

  it("treats an unrelated 401 refresh response as legacy protocol detection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, { message: "unauthorized" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const manager = createManager(createSessionMock(fetchMock));

    const context = await manager.getRequestContext("account-key", browserAccount());
    expect(context.authMode).toBe("browser_cookie");
    expect(context.headers).toEqual({ "New-Api-User": "42" });
    await expect(context.fetch("https://panel.example.com/api/user/self"))
      .resolves.toMatchObject({ status: 200 });
  });

  it("rejects a malformed successful modern refresh instead of downgrading to legacy", async () => {
    const fetchMock = vi.fn(async () => response(200, {
      success: true,
      data: {
        access_token: "incomplete-bearer",
        token_type: "Bearer",
      },
    }));
    const manager = createManager(createSessionMock(fetchMock));

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toThrow("浏览器登录协议响应异常（HTTP 200）");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(manager.getStatus("account-key").mode).toBe("unknown");
  });

  it("does not trust a matching legacy identity from a non-success response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(500, { success: true, data: { id: 42 } }));
    const recoveryWindow = createLoginWindowMock();
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(manager.getStatus("account-key").status).toBe("login_required");
    expect(recoveryWindow.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it("does not downgrade a confirmed modern request to legacy after a 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: {
          access_token: "bearer-a",
          token_type: "Bearer",
          access_expires_at: Math.floor(Date.now() / 1000) + 900,
          session: { sid: "sid-a" },
        },
      }))
      .mockResolvedValueOnce(response(401, { code: "AUTH_ACCESS_EXPIRED" }))
      .mockResolvedValueOnce(response(401, { message: "legacy unauthorized" }));
    const manager = createManager(createSessionMock(fetchMock));
    const context = await manager.getRequestContext("account-key", browserAccount());

    await expect(context.fetch("https://panel.example.com/api/user/self", {
      headers: { Authorization: "Bearer bearer-a" },
    })).rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(manager.getStatus("account-key").status).toBe("login_required");
  });

  it("completes legacy OAuth login by verifying the account-origin localStorage uid", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          "New-Api-User": "42",
        }));
        expect(init?.headers).not.toEqual(expect.objectContaining({ Cookie: expect.anything() }));
        expect(init?.headers).not.toEqual(expect.objectContaining({ Authorization: expect.anything() }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    const result = await manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });

    expect(result).toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    const script = vi.mocked(browserWindow.webContents.executeJavaScript).mock.calls[0][0];
    expect(script).toContain('window.localStorage.getItem("user")');
    expect(script).toContain('window.localStorage.getItem("uid")');
    const refreshHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(refreshHeaders["New-Api-User"]).toBeUndefined();
  });

  it("uses exact-origin localStorage user id and token without disclosing the token", async () => {
    const diagnostics = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer legacy-memory-token",
          "New-Api-User": "42",
        }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const browserWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: "00042", token: " legacy-memory-token " }),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
      onDiagnostic: diagnostics,
    });

    const loginResult = await manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    const context = await manager.getRequestContext("new-account", {
      ...browserAccount(),
      id: "new-account",
      browser_session_id: "new-reference",
    });

    expect(loginResult).toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(context.headers).toEqual({
      Authorization: "Bearer legacy-memory-token",
      "New-Api-User": "42",
    });
    expect(JSON.stringify(loginResult)).not.toContain("legacy-memory-token");
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("legacy-memory-token");
  });

  it("verifies a same-origin Sub2API auth_user and auth_token against root-level auth/me identity", async () => {
    const diagnostics = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockImplementationOnce(async (input, init?: RequestInit) => {
        expect(String(input)).toBe("https://panel.example.com/api/v1/auth/me");
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer sub2-memory-token",
          "New-Api-User": "42",
        }));
        return response(200, { id: 42, balance: 12.5, subscriptions: [] });
      });
    const browserWindow = createLoginWindowMock({
      localStorageAuthUser: JSON.stringify({ id: "00042", email: "must-not-cross-ipc@example.com" }),
      localStorageAuthToken: " sub2-memory-token ",
      localStorageRefreshToken: " sub2-refresh-token ",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
      onDiagnostic: diagnostics,
    });

    const loginResult = await manager.openLogin({
      accountKey: "sub2-account",
      browserSessionId: "sub2-reference",
      browserOrigin: "https://panel.example.com",
    });
    const context = await manager.getRequestContext("sub2-account", {
      ...browserAccount(),
      id: "sub2-account",
      browser_session_id: "sub2-reference",
    });

    expect(loginResult).toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(context.headers).toEqual({
      Authorization: "Bearer sub2-memory-token",
      "New-Api-User": "42",
    });
    const serializedPublicValues = JSON.stringify({ loginResult, diagnostics: diagnostics.mock.calls });
    expect(serializedPublicValues).not.toContain("sub2-memory-token");
    expect(serializedPublicValues).not.toContain("sub2-refresh-token");
    expect(serializedPublicValues).not.toContain("must-not-cross-ipc");
  });

  it("prefers strict Sub2API storage when a page also has a generic New API user", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }))
      .mockImplementationOnce(async (input, init?: RequestInit) => {
        expect(String(input)).toBe("https://panel.example.com/api/v1/auth/me");
        expect(new Headers(init?.headers).get("Authorization"))
          .toBe("Bearer sub2-memory-token");
        return response(200, { id: 42 });
      });
    const recoveryWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "wrong-new-api-token" }),
      localStorageAuthUser: JSON.stringify({ id: 42 }),
      localStorageAuthToken: "sub2-memory-token",
      localStorageRefreshToken: "sub2-refresh-token",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .resolves.toMatchObject({
        authMode: "browser_cookie",
        headers: { Authorization: "Bearer sub2-memory-token" },
      });
  });

  it("does not accept a nested Sub2API identity in place of the root id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }))
      .mockResolvedValueOnce(response(200, { data: { id: 42 } }));
    const recoveryWindow = createLoginWindowMock({
      localStorageAuthUser: JSON.stringify({ id: 42 }),
      localStorageAuthToken: "sub2-memory-token",
      localStorageRefreshToken: "sub2-refresh-token",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(fetchMock.mock.calls[2][0]).toBe("https://panel.example.com/api/v1/auth/me");
  });

  it("refreshes an expired Sub2API runtime bearer without persisting or returning either token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(200, { id: 42, balance: 1 }))
      .mockResolvedValueOnce(response(401, { message: "expired" }))
      .mockImplementationOnce(async (input, init?: RequestInit) => {
        expect(String(input)).toBe("https://panel.example.com/api/v1/auth/refresh");
        expect(init?.body).toBe(JSON.stringify({ refresh_token: "sub2-refresh-token" }));
        return response(200, {
          access_token: "sub2-refreshed-token",
          refresh_token: "sub2-next-refresh-token",
        });
      })
      .mockImplementationOnce(async (input, init?: RequestInit) => {
        expect(String(input)).toBe("https://panel.example.com/api/v1/auth/me");
        expect(new Headers(init?.headers).get("Authorization"))
          .toBe("Bearer sub2-refreshed-token");
        return response(200, { id: 42, balance: 2 });
      })
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("Authorization"))
          .toBe("Bearer sub2-refreshed-token");
        return response(200, { id: 42, balance: 2 });
      });
    const browserWindow = createLoginWindowMock({
      localStorageAuthUser: JSON.stringify({ id: 42 }),
      localStorageAuthToken: "sub2-memory-token",
      localStorageRefreshToken: "sub2-refresh-token",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });
    const loginResult = await manager.openLogin({
      accountKey: "sub2-account",
      browserSessionId: "sub2-reference",
      browserOrigin: "https://panel.example.com",
    });
    const context = await manager.getRequestContext("sub2-account", {
      ...browserAccount(),
      id: "sub2-account",
      browser_session_id: "sub2-reference",
    });

    const refreshedResponse = await context.fetch("https://panel.example.com/api/v1/auth/me", {
      headers: context.headers,
    });
    expect(refreshedResponse.status).toBe(200);
    expect(JSON.stringify(loginResult)).not.toContain("sub2-memory-token");
    expect(JSON.stringify(loginResult)).not.toContain("sub2-refresh-token");
  });

  it("coalesces Sub2API refresh when a stale 401 arrives after credentials rotate", async () => {
    const staleResponses: Array<(value: Response) => void> = [];
    let oldBearerRequests = 0;
    let refreshRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/api/user/auth/refresh")) {
        return response(404, { message: "legacy" });
      }
      if (url.endsWith("/api/v1/auth/refresh")) {
        refreshRequests += 1;
        return response(200, {
          access_token: "sub2-refreshed-token",
          refresh_token: "sub2-next-refresh-token",
        });
      }
      if (url.endsWith("/api/v1/auth/me") && authorization === "Bearer sub2-memory-token") {
        oldBearerRequests += 1;
        if (oldBearerRequests === 1) return response(200, { id: 42 });
        return new Promise<Response>((resolve) => staleResponses.push(resolve));
      }
      if (url.endsWith("/api/v1/auth/me") && authorization === "Bearer sub2-refreshed-token") {
        return response(200, { id: 42, balance: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const browserWindow = createLoginWindowMock({
      localStorageAuthUser: JSON.stringify({ id: 42 }),
      localStorageAuthToken: "sub2-memory-token",
      localStorageRefreshToken: "sub2-refresh-token",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });
    await manager.openLogin({
      accountKey: "sub2-account",
      browserSessionId: "sub2-reference",
      browserOrigin: "https://panel.example.com",
    });
    const context = await manager.getRequestContext("sub2-account", {
      ...browserAccount(),
      id: "sub2-account",
      browser_session_id: "sub2-reference",
    });

    const first = context.fetch("https://panel.example.com/api/v1/auth/me", {
      headers: context.headers,
    });
    const second = context.fetch("https://panel.example.com/api/v1/auth/me", {
      headers: context.headers,
    });
    await vi.waitFor(() => expect(staleResponses).toHaveLength(2));
    staleResponses[0](response(401, { message: "expired" }));
    await expect(first).resolves.toMatchObject({ status: 200 });
    staleResponses[1](response(401, { message: "expired" }));
    await expect(second).resolves.toMatchObject({ status: 200 });

    expect(refreshRequests).toBe(1);
    expect(manager.getStatus("sub2-account")).toMatchObject({ status: "ready" });
  });

  it("coalesces modern refresh and retries a late stale 401 with the latest bearer", async () => {
    const staleResponses: Array<(value: Response) => void> = [];
    let refreshRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/api/user/auth/refresh")) {
        refreshRequests += 1;
        const suffix = refreshRequests === 1 ? "a" : "b";
        return response(200, {
          success: true,
          data: {
            access_token: `bearer-${suffix}`,
            token_type: "Bearer",
            access_expires_at: Math.floor(Date.now() / 1000) + 900,
            session: { sid: `sid-${suffix}` },
          },
        });
      }
      if (authorization === "Bearer bearer-a") {
        return new Promise<Response>((resolve) => staleResponses.push(resolve));
      }
      if (authorization === "Bearer bearer-b") {
        return response(200, { success: true, data: { id: 42 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = createManager(createSessionMock(fetchMock));
    const context = await manager.getRequestContext("account-key", browserAccount());

    const first = context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    });
    const second = context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    });
    await vi.waitFor(() => expect(staleResponses).toHaveLength(2));
    staleResponses[0](response(401, { code: "AUTH_ACCESS_EXPIRED" }));
    await expect(first).resolves.toMatchObject({ status: 200 });
    staleResponses[1](response(401, { code: "AUTH_ACCESS_EXPIRED" }));
    await expect(second).resolves.toMatchObject({ status: 200 });

    expect(refreshRequests).toBe(2);
    expect(manager.getStatus("account-key")).toMatchObject({ mode: "modern", status: "ready" });
  });

  it("falls back to localStorage uid when localStorage user is malformed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          "New-Api-User": "42",
        }));
        expect(init?.headers).not.toEqual(expect.objectContaining({
          Authorization: expect.anything(),
        }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const browserWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 0, token: "must-not-be-used" }),
      localStorageUid: "42",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toMatchObject({ status: "ready", userId: "42" });
  });

  it("retries legacy New API identity without a rejected localStorage bearer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer page-only-token");
        expect(headers.get("New-Api-User")).toBe("42");
        return response(403, { message: "invalid bearer for management endpoint" });
      })
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("New-Api-User")).toBe("42");
        return response(200, { success: true, data: { id: 42 } });
      })
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("New-Api-User")).toBe("42");
        return response(200, { success: true, data: { id: 42 } });
      });
    const browserWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "page-only-token" }),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });

    const context = await manager.getRequestContext("new-account", {
      ...browserAccount(),
      id: "new-account",
      browser_session_id: "new-reference",
    });
    expect(context.headers).toEqual({ "New-Api-User": "42" });
    await expect(context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    })).resolves.toMatchObject({ status: 200 });
  });

  it("uses the same-origin page transport when Session.fetch stays forbidden", async () => {
    const diagnostics = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(403, { message: "session transport forbidden" }))
      .mockResolvedValueOnce(response(403, { message: "session transport still forbidden" }))
      .mockResolvedValueOnce(response(403, { message: "runtime session transport forbidden" }));
    const loginWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "page-only-token" }),
      pageFetchResults: [{
        status: 200,
        body: JSON.stringify({ success: true, data: { id: 42 } }),
      }],
    });
    const requestWindow = createLoginWindowMock({
      currentUrl: "https://panel.example.com/",
      pageFetchResults: [{
        status: 200,
        body: JSON.stringify({ success: true, data: { id: 42, quota: 100 } }),
      }],
    });
    const createWindow = vi.fn()
      .mockReturnValueOnce(loginWindow)
      .mockReturnValueOnce(requestWindow);
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow,
      pollIntervalMs: 1,
      onDiagnostic: diagnostics,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toMatchObject({ status: "ready", userId: "42" });
    const context = await manager.getRequestContext("new-account", {
      ...browserAccount(),
      id: "new-account",
      browser_session_id: "new-reference",
    });
    const runtimeResponse = await context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    });

    expect(runtimeResponse.status).toBe(200);
    await expect(runtimeResponse.json()).resolves.toMatchObject({ data: { id: 42, quota: 100 } });
    expect(context.headers).toEqual({ "New-Api-User": "42" });
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      event: "login_probe_result",
      transport: "page_fetch",
      result: "ready",
    }));
    const pageScripts = [loginWindow, requestWindow].flatMap((window) =>
      vi.mocked(window.webContents.executeJavaScript).mock.calls.map(([script]) => script));
    expect(pageScripts.filter((script) => script.includes("window.fetch(request.url"))).toHaveLength(2);
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("page-only-token");
    await manager.logout("new-account", {
      ...browserAccount(),
      id: "new-account",
      browser_session_id: "new-reference",
    });
    expect(requestWindow.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched identity returned by the page transport", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(403, { message: "session transport forbidden" }))
      .mockResolvedValueOnce(response(403, { message: "session transport still forbidden" }));
    const browserWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "page-only-token" }),
      pageFetchResults: [{
        status: 200,
        body: JSON.stringify({ success: true, data: { id: 7 } }),
      }],
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "account_mismatch",
      message: "浏览器中登录的账号与目标账号不一致",
    });
  });

  it("does not accept a mismatched identity from the no-bearer fallback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(403, { message: "bearer rejected" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 7 } }));
    const browserWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "page-only-token" }),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "account_mismatch",
      message: "浏览器中登录的账号与目标账号不一致",
    });
  });

  it("recovers a legacy token from a hidden same-origin persistent partition on cold start", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer recovered-memory-token",
          "New-Api-User": "42",
        }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const session = createSessionMock(fetchMock);
    const recoveryWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "recovered-memory-token" }),
    });
    const createWindow = vi.fn(() => recoveryWindow);
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow,
    });

    const context = await manager.getRequestContext("account-key", browserAccount());

    expect(context.headers).toEqual({
      Authorization: "Bearer recovered-memory-token",
      "New-Api-User": "42",
    });
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: expect.objectContaining({
        partition: "persist:codedeck-newapi-opaque-1",
        sandbox: true,
      }),
    }));
    expect(recoveryWindow.show).not.toHaveBeenCalled();
    expect(recoveryWindow.focus).not.toHaveBeenCalled();
    expect(recoveryWindow.close).toHaveBeenCalledTimes(1);

    await manager.logout("account-key", browserAccount());
    await expect(context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    })).rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("drops a rejected recovered New API bearer on cold start", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie needs user id" }))
      .mockResolvedValueOnce(response(403, { message: "bearer rejected" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("New-Api-User")).toBe("42");
        return response(200, { success: true, data: { id: 42 } });
      });
    const recoveryWindow = createLoginWindowMock({
      localStorageUser: JSON.stringify({ id: 42, token: "rejected-recovered-token" }),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    const context = await manager.getRequestContext("account-key", browserAccount());

    expect(context.headers).toEqual({ "New-Api-User": "42" });
    expect(JSON.stringify(context.headers)).not.toContain("rejected-recovered-token");
  });

  it("recovers Sub2API runtime credentials from a hidden same-origin partition on cold start", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }))
      .mockImplementationOnce(async (input, init?: RequestInit) => {
        expect(String(input)).toBe("https://panel.example.com/api/v1/auth/me");
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer recovered-sub2-token",
        }));
        return response(200, { id: 42, balance: 8 });
      });
    const recoveryWindow = createLoginWindowMock({
      localStorageAuthUser: JSON.stringify({ id: 42 }),
      localStorageAuthToken: "recovered-sub2-token",
      localStorageRefreshToken: "recovered-sub2-refresh",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    const context = await manager.getRequestContext("account-key", browserAccount());

    expect(context.headers.Authorization).toBe("Bearer recovered-sub2-token");
    expect(recoveryWindow.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(recoveryWindow.close).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled hidden recovery navigation and closes its window", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }));
    const recoveryWindow = createLoginWindowMock({
      loadURL: () => new Promise<void>(() => undefined),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
      navigationTimeoutMs: 5,
    });

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(recoveryWindow.webContents.stop).toHaveBeenCalledTimes(1);
    expect(recoveryWindow.close).toHaveBeenCalledTimes(1);
  });

  it("closes an in-flight hidden recovery window when the account logs out", async () => {
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }));
    const recoveryWindow = createLoginWindowMock({ loadURL: () => navigation });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    const pendingContext = manager.getRequestContext("account-key", browserAccount());
    void pendingContext.catch(() => undefined);
    await vi.waitFor(() => expect(recoveryWindow.loadURL).toHaveBeenCalledTimes(1));

    await manager.logout("account-key", browserAccount());
    expect(recoveryWindow.close).toHaveBeenCalledTimes(1);
    finishNavigation();
    await expect(pendingContext).rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses cold-start legacy storage recovery from a non-account origin", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "cookie expired" }));
    const recoveryWindow = createLoginWindowMock({
      currentUrl: "https://connect.linux.do/oauth2/authorize",
      localStorageUser: JSON.stringify({ id: 42, token: "must-not-be-read" }),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => recoveryWindow),
    });

    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(recoveryWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("must-not-be-read");
  });

  it("shows the login window before initial navigation finishes and still allows cancellation", async () => {
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = resolve;
    });
    const fetchMock = vi.fn();
    const browserWindow = createLoginWindowMock();
    vi.mocked(browserWindow.loadURL).mockImplementation(() => {
      expect(browserWindow.show).toHaveBeenCalledTimes(1);
      expect(browserWindow.focus).toHaveBeenCalledTimes(1);
      return navigation;
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
    });

    const login = manager.openLogin({
      accountKey: "slow-account",
      browserSessionId: "slow-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(browserWindow.loadURL).toHaveBeenCalled());

    expect(browserWindow.show).toHaveBeenCalledTimes(1);
    expect(browserWindow.focus).toHaveBeenCalledTimes(1);
    browserWindow.close();
    await expect(login).resolves.toEqual({
      status: "canceled",
      message: "已取消浏览器登录",
    });
    finishNavigation();
    await navigation;
    await vi.waitFor(() => {
      expect(manager.getStatus("slow-account").status).toBe("login_required");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads a separate login URL and confirms user-managed identity when the window closes", async () => {
    const fetchMock = vi.fn();
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({
      currentUrl: "https://login.example.com/sign-in",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    const login = manager.openLogin({
      accountKey: "custom-account",
      browserSessionId: "custom-reference",
      browserOrigin: "https://identity.example.com",
      loginUrl: "https://login.example.com/sign-in",
      identityMode: "user_confirmed",
    });
    await vi.waitFor(() => {
      expect(browserWindow.loadURL).toHaveBeenCalledWith("https://login.example.com/sign-in");
    });

    expect(isAllowedBrowserNavigation(
      "https://identity.example.com/account",
      ["https://identity.example.com", "https://login.example.com"],
    )).toBe(true);
    expect(isAllowedBrowserNavigation(
      "https://login.example.com/callback",
      ["https://identity.example.com", "https://login.example.com"],
    )).toBe(true);
    expect(isAllowedBrowserNavigation(
      "https://other.example.com/callback",
      ["https://identity.example.com", "https://login.example.com"],
    )).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    browserWindow.close();
    await expect(login).resolves.toEqual({
      status: "ready",
      message: "已确认浏览器身份",
    });
    expect(session.cookies.flushStore).toHaveBeenCalledOnce();
    expect(browserWindow.isDestroyed()).toBe(true);
  });

  it("fails and closes a login window when initial navigation never settles", async () => {
    const browserWindow = createLoginWindowMock({
      loadURL: () => new Promise<void>(() => undefined),
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(vi.fn())),
      createWindow: vi.fn(() => browserWindow),
      navigationTimeoutMs: 5,
    });

    await expect(manager.openLogin({
      accountKey: "stalled-navigation",
      browserSessionId: "stalled-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "failed",
      message: "浏览器登录窗口加载失败",
    });
    expect(browserWindow.webContents.stop).toHaveBeenCalled();
    expect(browserWindow.isDestroyed()).toBe(true);
  });

  it("keeps modern interactive login isolated from legacy identity storage and headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, {
        success: true,
        data: {
          access_token: "modern-bearer",
          token_type: "Bearer",
          access_expires_at: Math.floor(Date.now() / 1000) + 900,
          session: { sid: "modern-sid" },
        },
      }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer modern-bearer",
        }));
        expect(init?.headers).not.toEqual(expect.objectContaining({
          "New-Api-User": expect.anything(),
        }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(browserWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it("does not complete modern login from a non-success identity response with a matching id", async () => {
    const authBundle = {
      success: true,
      data: {
        access_token: "modern-bearer",
        token_type: "Bearer",
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
        session: { sid: "modern-sid" },
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, authBundle))
      .mockResolvedValueOnce(response(500, { success: true, data: { id: 42 } }))
      .mockResolvedValueOnce(response(500, { success: true, data: { id: 42 } }));
    const browserWindow = createLoginWindowMock();
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    browserWindow.close();

    await expect(login).resolves.toEqual({
      status: "canceled",
      message: "已取消浏览器登录",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(browserWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it("rejects PAT accounts before creating browser-session state", async () => {
    const createSession = vi.fn(() => createSessionMock(vi.fn()));
    const manager = new BrowserAccountSessionManager({
      createSession,
      createWindow: vi.fn(() => ({} as BrowserWindow)),
    });
    const account = {
      ...browserAccount(),
      auth_kind: "access_token" as const,
      access_token: "pat-token",
      browser_session_id: undefined,
      browser_origin: undefined,
    };

    await expect(manager.getRequestContext("pat-account", account))
      .rejects.toThrow("账号不是浏览器登录类型");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a legacy localStorage uid that does not match the verified response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 43 } }));
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "account_mismatch",
      message: "浏览器中登录的账号与目标账号不一致",
    });
  });

  it("does not read localStorage while the login window is on LinuxDo", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const browserWindow = createLoginWindowMock({
      currentUrl: "https://connect.linux.do/oauth2/authorize",
      localStorageUid: "42",
    });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });

    await expect(login).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(browserWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
    const selfHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(selfHeaders["New-Api-User"]).toBeUndefined();
  });

  it("does not send a non-positive localStorage uid as a legacy identity candidate", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const browserWindow = createLoginWindowMock({ localStorageUid: "0" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    const selfHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(selfHeaders["New-Api-User"]).toBeUndefined();
  });

  it("normalizes a positive integer localStorage uid before identity verification", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(init?.headers).toEqual(expect.objectContaining({
          "New-Api-User": "42",
        }));
        return response(200, { success: true, data: { id: 42 } });
      });
    const browserWindow = createLoginWindowMock({ localStorageUid: "00042" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    await expect(manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    })).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
  });

  it("coalesces an in-flight probe and completes ready when the window closes after login", async () => {
    let resolveIdentity!: (value: Response) => void;
    const pendingIdentity = new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockImplementationOnce(() => pendingIdentity);
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    browserWindow.close();
    resolveIdentity(response(200, { success: true, data: { id: 42 } }));
    await expect(login).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.cookies.flushStore).toHaveBeenCalledTimes(1);
  });

  it("bounds the final close probe so an unresponsive site cannot trap the window", async () => {
    let resolveIdentity!: (value: Response) => void;
    const pendingIdentity = new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockImplementationOnce(() => pendingIdentity);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => createSessionMock(fetchMock)),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
      probeTimeoutMs: 60_000,
      closeProbeTimeoutMs: 5,
    });

    const login = manager.openLogin({
      accountKey: "unresponsive-account",
      browserSessionId: "unresponsive-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    browserWindow.close();

    await expect(login).resolves.toEqual({
      status: "canceled",
      message: "已取消浏览器登录",
    });
    expect(browserWindow.isDestroyed()).toBe(true);
    resolveIdentity(response(200, { success: true, data: { id: 42 } }));
  });

  it("runs one final probe before treating a manual window close as cancellation", async () => {
    const diagnostics = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "anonymous" }))
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
      onDiagnostic: diagnostics,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledWith({
      event: "login_probe_result",
      authMode: "browser_cookie",
      transport: "session_fetch",
      httpStatus: 401,
      result: "retry",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    browserWindow.close();

    await expect(login).resolves.toEqual({
      status: "ready",
      userId: "42",
      message: "浏览器登录成功",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("cancels after the final close probe still cannot verify login", async () => {
    const diagnostics = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(401, { message: "anonymous" }))
      .mockResolvedValueOnce(response(401, { message: "still anonymous" }));
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 60_000,
      onDiagnostic: diagnostics,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    browserWindow.close();

    await expect(login).resolves.toEqual({
      status: "canceled",
      message: "已取消浏览器登录",
    });
    expect(manager.getStatus("new-account").status).toBe("login_required");
    expect(session.cookies.flushStore).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith({
      event: "login_canceled",
      reason: "window_close_unverified",
    });
  });

  it("rejects a late identity result after explicit cancellation is confirmed", async () => {
    let resolveIdentity!: (value: Response) => void;
    const pendingIdentity = new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "not found" }))
      .mockImplementationOnce(() => pendingIdentity);
    const session = createSessionMock(fetchMock);
    const browserWindow = createLoginWindowMock({ localStorageUid: "42" });
    const manager = new BrowserAccountSessionManager({
      createSession: vi.fn(() => session),
      createWindow: vi.fn(() => browserWindow),
      pollIntervalMs: 1,
    });

    const login = manager.openLogin({
      accountKey: "new-account",
      browserSessionId: "new-reference",
      browserOrigin: "https://panel.example.com",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await manager.cancelLogin("new-account");
    await expect(login).resolves.toEqual({
      status: "canceled",
      message: "已取消浏览器登录",
    });

    resolveIdentity(response(200, { success: true, data: { id: 42 } }));
    await vi.waitFor(() => {
      expect(manager.getStatus("new-account").status).toBe("login_required");
    });
    expect(session.cookies.flushStore).not.toHaveBeenCalled();
  });

  it("surfaces confirmed anonymous refresh as login_required without legacy downgrade", async () => {
    const manager = createManager(createSessionMock(vi.fn(async () => response(401, {
      success: false,
      code: "AUTH_REFRESH_INVALID",
    }))));
    await expect(manager.getRequestContext("account-key", browserAccount()))
      .rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(manager.getStatus("account-key").status).toBe("login_required");
  });

  it("rejects a modern refresh that finishes flushing after logout", async () => {
    let releaseRefreshFlush!: () => void;
    const refreshFlush = new Promise<void>((resolve) => {
      releaseRefreshFlush = resolve;
    });
    const fetchMock = vi.fn(async () => response(200, {
      success: true,
      data: {
        access_token: "late-bearer",
        token_type: "Bearer",
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
        session: { sid: "late-sid" },
      },
    }));
    const session = createSessionMock(fetchMock);
    vi.mocked(session.cookies.flushStore)
      .mockImplementationOnce(() => refreshFlush)
      .mockResolvedValueOnce(undefined);
    const manager = createManager(session);
    const account = browserAccount();

    const context = manager.getRequestContext("account-key", account);
    await vi.waitFor(() => expect(session.cookies.flushStore).toHaveBeenCalledTimes(1));
    await manager.logout("account-key", account);
    releaseRefreshFlush();

    await expect(context).rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(manager.getStatus("account-key").status).toBe("login_required");
  });

  it("preserves partition storage on shutdown and clears only the account origin on logout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { message: "legacy" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const session = createSessionMock(fetchMock);
    const account = browserAccount();
    const manager = createManager(session);
    const context = await manager.getRequestContext("account-key", account);

    await manager.shutdown();
    expect(session.clearStorageData).not.toHaveBeenCalled();
    expect(session.clearCache).not.toHaveBeenCalled();
    await expect(context.fetch("https://panel.example.com/api/user/self", {
      headers: context.headers,
    })).rejects.toBeInstanceOf(BrowserLoginRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondManager = createManager(session);
    await secondManager.logout("account-key", account);
    expect(session.clearStorageData).toHaveBeenCalledWith({
      origin: "https://panel.example.com",
    });
    expect(session.clearCache).not.toHaveBeenCalled();
  });

  it("clears only the binding origin when deleting a shared slot reference", async () => {
    const session = createSessionMock(vi.fn());
    const manager = createManager(session);

    await manager.deleteAccount("account-key", browserAccount(), false);

    expect(session.clearStorageData).toHaveBeenCalledTimes(1);
    expect(session.clearStorageData).toHaveBeenCalledWith({
      origin: "https://panel.example.com",
    });
    expect(session.clearCache).not.toHaveBeenCalled();
  });

  it("clears the whole partition when deleting its final reference", async () => {
    const session = createSessionMock(vi.fn());
    const manager = createManager(session);

    await manager.deleteAccount("account-key", browserAccount(), true);

    expect(session.clearStorageData).toHaveBeenCalledTimes(1);
    expect(session.clearStorageData).toHaveBeenCalledWith();
    expect(session.clearCache).toHaveBeenCalledTimes(1);
  });

  it("clears an unpersisted partition when a new login is discarded", async () => {
    const session = createSessionMock(vi.fn());
    const manager = createManager(session);

    await manager.discardReference("new-account-key", "new-account-reference");

    expect(session.clearStorageData).toHaveBeenCalledTimes(1);
    expect(session.clearCache).toHaveBeenCalledTimes(1);
    expect(session.cookies.flushStore).toHaveBeenCalledTimes(1);
    expect(manager.getStatus("new-account-key")).toEqual({
      accountKey: "new-account-key",
      mode: "unknown",
      status: "unknown",
    });
  });
});
