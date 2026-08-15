import type { WebContents } from "electron";

export type BrowserNavigationAction = "back" | "forward" | "reload" | "stop";

interface NavigationWebContents extends Pick<WebContents, "reload" | "stop"> {
  navigationHistory: Pick<
    WebContents["navigationHistory"],
    "canGoBack" | "canGoForward" | "goBack" | "goForward"
  >;
}

export function runBrowserNavigationAction(
  webContents: NavigationWebContents,
  action: BrowserNavigationAction,
): boolean {
  switch (action) {
    case "back":
      if (!webContents.navigationHistory.canGoBack()) return false;
      webContents.navigationHistory.goBack();
      return true;
    case "forward":
      if (!webContents.navigationHistory.canGoForward()) return false;
      webContents.navigationHistory.goForward();
      return true;
    case "reload":
      webContents.reload();
      return true;
    case "stop":
      webContents.stop();
      return true;
  }
}
