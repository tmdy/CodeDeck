import type { BrowserWindow, BrowserWindowConstructorOptions, Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  CustomElementSelectorService,
  isAllowedCustomSelectorNavigation,
  normalizeSelectorResult,
} from "../../electron/custom-element-selector-service.js";

describe("custom-element-selector-service", () => {
  it("accepts only exact-origin http navigation", () => {
    expect(isAllowedCustomSelectorNavigation(
      "https://console.example.com/account/balance",
      "https://console.example.com",
    )).toBe(true);
    expect(isAllowedCustomSelectorNavigation(
      "https://api.example.com/account/balance",
      "https://console.example.com",
    )).toBe(false);
    expect(isAllowedCustomSelectorNavigation(
      "javascript:alert(1)",
      "https://console.example.com",
    )).toBe(false);
  });

  it("returns only a bounded selector and sanitized preview", () => {
    expect(normalizeSelectorResult({
      selector: "  #balance-card .amount  ",
      previewText: "  剩余\n 12.50 元\u0000  ",
      outerHTML: "<div>must not escape</div>",
      cookie: "must not escape",
    })).toEqual({
      selector: "#balance-card .amount",
      previewText: "剩余 12.50 元",
    });
  });

  it("rejects malformed or oversized selector results", () => {
    expect(normalizeSelectorResult(null)).toBeNull();
    expect(normalizeSelectorResult({ selector: "", previewText: "x" })).toBeNull();
    expect(normalizeSelectorResult({ selector: "a\nb", previewText: "x" })).toBeNull();
    expect(normalizeSelectorResult({ selector: "x".repeat(513), previewText: "x" })).toBeNull();
  });

  it("uses the supplied account partition and blocks navigation outside the declared origin", async () => {
    const sessionHandlers = new Map<string, unknown>();
    const browserSession = {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      on: vi.fn((event: string, handler: unknown) => {
        sessionHandlers.set(event, handler);
      }),
    } as unknown as Session;
    const webContentsHandlers = new Map<string, (...args: unknown[]) => void>();
    let destroyed = false;
    let windowOptions: BrowserWindowConstructorOptions | undefined;
    const browserWindow = {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          webContentsHandlers.set(event, handler);
        }),
        executeJavaScript: vi.fn(async () => ({
          selector: "#balance",
          previewText: "12.5",
        })),
      },
      once: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(() => {
        destroyed = true;
      }),
      isDestroyed: vi.fn(() => destroyed),
    } as unknown as BrowserWindow;
    const service = new CustomElementSelectorService({
      createSession: vi.fn(() => browserSession),
      createWindow: vi.fn((options) => {
        windowOptions = options;
        return browserWindow;
      }),
    });

    await expect(service.selectElement({
      pageUrl: "https://console.example.com/account/balance",
      partition: "persist:custom-account",
    })).resolves.toEqual({ selector: "#balance", previewText: "12.5" });

    expect(windowOptions?.webPreferences?.partition).toBe("persist:custom-account");
    expect(browserWindow.loadURL).toHaveBeenCalledWith("https://console.example.com/account/balance");
    expect(sessionHandlers.has("will-download")).toBe(true);
    const blocked = { preventDefault: vi.fn() };
    webContentsHandlers.get("will-navigate")?.(blocked, "https://other.example.com/path");
    expect(blocked.preventDefault).toHaveBeenCalledOnce();
    const allowed = { preventDefault: vi.fn() };
    webContentsHandlers.get("will-navigate")?.(allowed, "https://console.example.com/other");
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });
});
