import { describe, expect, it, vi } from "vitest";
import { revealAndFocusMainWindow } from "../../electron/main-window-reactivation.js";

function createWindow(options: {
  destroyed?: boolean;
  minimized?: boolean;
  visible?: boolean;
} = {}) {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    isVisible: vi.fn(() => options.visible ?? true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

describe("main window reactivation", () => {
  it("restores, shows and focuses the existing main window", () => {
    const browserWindow = createWindow({ minimized: true, visible: false });

    expect(revealAndFocusMainWindow(browserWindow)).toBe(true);
    expect(browserWindow.restore).toHaveBeenCalledOnce();
    expect(browserWindow.show).toHaveBeenCalledOnce();
    expect(browserWindow.focus).toHaveBeenCalledOnce();
  });

  it("does not interact with a destroyed window", () => {
    const browserWindow = createWindow({ destroyed: true });

    expect(revealAndFocusMainWindow(browserWindow)).toBe(false);
    expect(browserWindow.restore).not.toHaveBeenCalled();
    expect(browserWindow.show).not.toHaveBeenCalled();
    expect(browserWindow.focus).not.toHaveBeenCalled();
  });
});
