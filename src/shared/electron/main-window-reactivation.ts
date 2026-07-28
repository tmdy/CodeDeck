export interface ReactivatableMainWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function revealAndFocusMainWindow(browserWindow: ReactivatableMainWindow): boolean {
  if (browserWindow.isDestroyed()) {
    return false;
  }
  if (browserWindow.isMinimized()) {
    browserWindow.restore();
  }
  if (!browserWindow.isVisible()) {
    browserWindow.show();
  }
  browserWindow.focus();
  return true;
}
