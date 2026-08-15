import { describe, expect, it, vi } from "vitest";
import { runBrowserNavigationAction } from "../../electron/browser-navigation.js";

function createWebContents(canGoBack: boolean = true, canGoForward: boolean = true) {
  return {
    navigationHistory: {
      canGoBack: vi.fn(() => canGoBack),
      canGoForward: vi.fn(() => canGoForward),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    reload: vi.fn(),
    stop: vi.fn(),
  };
}

describe("runBrowserNavigationAction", () => {
  it("navigates through available history", () => {
    const webContents = createWebContents();

    expect(runBrowserNavigationAction(webContents, "back")).toBe(true);
    expect(runBrowserNavigationAction(webContents, "forward")).toBe(true);
    expect(webContents.navigationHistory.goBack).toHaveBeenCalledTimes(1);
    expect(webContents.navigationHistory.goForward).toHaveBeenCalledTimes(1);
  });

  it("does not navigate past either end of history", () => {
    const webContents = createWebContents(false, false);

    expect(runBrowserNavigationAction(webContents, "back")).toBe(false);
    expect(runBrowserNavigationAction(webContents, "forward")).toBe(false);
    expect(webContents.navigationHistory.goBack).not.toHaveBeenCalled();
    expect(webContents.navigationHistory.goForward).not.toHaveBeenCalled();
  });

  it("supports reload and stop", () => {
    const webContents = createWebContents();

    expect(runBrowserNavigationAction(webContents, "reload")).toBe(true);
    expect(runBrowserNavigationAction(webContents, "stop")).toBe(true);
    expect(webContents.reload).toHaveBeenCalledTimes(1);
    expect(webContents.stop).toHaveBeenCalledTimes(1);
  });
});
