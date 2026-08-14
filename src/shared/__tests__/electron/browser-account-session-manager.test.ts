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
  localStorageUid?: unknown;
  loadURL?: () => Promise<void>;
} = {}): BrowserWindow {
  const windowListeners = new Map<string, () => void>();
  let destroyed = false;
  const browserWindow = {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getURL: vi.fn(() => options.currentUrl ?? "https://panel.example.com/oauth/callback"),
      executeJavaScript: vi.fn(async () => options.localStorageUid ?? null),
    },
    loadURL: vi.fn(options.loadURL ?? (async () => undefined)),
    on: vi.fn((event: string, listener: () => void) => {
      windowListeners.set(event, listener);
    }),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(() => {
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
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const manager = createManager(createSessionMock(fetchMock));
    const context = await manager.getRequestContext("account-key", browserAccount());
    await context.fetch("https://panel.example.com/api/user/self", {
      headers: { Accept: "application/json" },
    });

    expect(context.authMode).toBe("browser_cookie");
    expect(context.headers).toEqual({});
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      credentials: "include",
      redirect: "manual",
    }));
    expect(fetchMock.mock.calls[1][1]?.headers).not.toEqual(expect.objectContaining({ Cookie: expect.anything() }));
  });

  it("treats an unrelated 401 refresh response as legacy protocol detection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, { message: "unauthorized" }))
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 42 } }));
    const manager = createManager(createSessionMock(fetchMock));

    const context = await manager.getRequestContext("account-key", browserAccount());
    expect(context.authMode).toBe("browser_cookie");
    await expect(context.fetch("https://panel.example.com/api/user/self"))
      .resolves.toMatchObject({ status: 200 });
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
    expect(browserWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.location.origin === "https://panel.example.com" ? window.localStorage.getItem("uid") : null',
      true,
    );
    const refreshHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(refreshHeaders["New-Api-User"]).toBeUndefined();
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
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("rejects a late identity result after the login window is closed", async () => {
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
    const fetchMock = vi.fn(async () => response(404, { message: "legacy" }));
    const session = createSessionMock(fetchMock);
    const account = browserAccount();
    const manager = createManager(session);
    await manager.getRequestContext("account-key", account);

    await manager.shutdown();
    expect(session.clearStorageData).not.toHaveBeenCalled();
    expect(session.clearCache).not.toHaveBeenCalled();

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
