import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";

export interface CustomElementSelectorResult {
  selector: string;
  previewText: string;
}

export interface OpenCustomElementSelectorOptions {
  pageUrl: string;
  partition: string;
  title?: string;
}

export interface CustomElementSelectorServiceDependencies {
  createSession: (partition: string) => Session;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getParentWindow?: () => BrowserWindow | null;
  windowIcon?: string;
}

const MAX_SELECTOR_LENGTH = 512;
const MAX_PREVIEW_LENGTH = 160;

export class CustomElementSelectorService {
  constructor(private readonly dependencies: CustomElementSelectorServiceDependencies) {}

  async selectElement(
    options: OpenCustomElementSelectorOptions,
  ): Promise<CustomElementSelectorResult | null> {
    const pageUrl = normalizeHttpUrl(options.pageUrl);
    const allowedOrigin = new URL(pageUrl).origin;
    const browserSession = this.dependencies.createSession(options.partition);
    configureSessionSecurity(browserSession);

    const browserWindow = this.dependencies.createWindow(
      this.buildWindowOptions(options.partition, options.title),
    );
    configureWindowSecurity(browserWindow, allowedOrigin);

    let closed = false;
    const closedPromise = new Promise<null>((resolve) => {
      browserWindow.once("closed", () => {
        closed = true;
        resolve(null);
      });
    });

    try {
      await browserWindow.loadURL(pageUrl);
      if (closed || browserWindow.isDestroyed()) {
        return null;
      }
      browserWindow.show();
      browserWindow.focus();

      const selected = await Promise.race([
        browserWindow.webContents.executeJavaScript(buildElementSelectorScript(), true),
        closedPromise,
      ]);
      return normalizeSelectorResult(selected);
    } finally {
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    }
  }

  private buildWindowOptions(
    partition: string,
    title: string | undefined,
  ): BrowserWindowConstructorOptions {
    const parent = this.dependencies.getParentWindow?.() ?? undefined;
    return {
      title: title?.trim() || "CodeDeck 元素选择器",
      width: 1180,
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
}

export function normalizeSelectorResult(value: unknown): CustomElementSelectorResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.selector !== "string" || typeof record.previewText !== "string") {
    return null;
  }
  const selector = record.selector.trim();
  if (!selector || selector.length > MAX_SELECTOR_LENGTH || /[\r\n\0]/.test(selector)) {
    return null;
  }
  return {
    selector,
    previewText: sanitizePreviewText(record.previewText),
  };
}

export function isAllowedCustomSelectorNavigation(
  targetUrl: string,
  allowedOrigin: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    return (target.protocol === "http:" || target.protocol === "https:")
      && target.origin === allowedOrigin;
  } catch {
    return false;
  }
}

function configureSessionSecurity(browserSession: Session): void {
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  browserSession.on("will-download", (event) => event.preventDefault());
}

function configureWindowSecurity(browserWindow: BrowserWindow, allowedOrigin: string): void {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedCustomSelectorNavigation(targetUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isAllowedCustomSelectorNavigation(targetUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });
  browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function normalizeHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("元素选择页面地址格式无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("元素选择页面仅支持 http:// 或 https:// 地址");
  }
  return parsed.toString();
}

function sanitizePreviewText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PREVIEW_LENGTH);
}

function buildElementSelectorScript(): string {
  return `(() => new Promise((resolve) => {
    const marker = "data-codedeck-element-selector";
    const forbiddenTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "META", "LINK"]);
    const sensitivePattern = /pass(word)?|secret|token|authorization|cookie|session|credential|api[-_ ]?key/i;
    let hovered = null;

    const style = document.createElement("style");
    style.setAttribute(marker, "style");
    style.textContent = "[data-codedeck-selector-hover]{outline:3px solid #2563eb!important;outline-offset:2px!important;cursor:crosshair!important}";
    document.documentElement.appendChild(style);

    const tip = document.createElement("div");
    tip.setAttribute(marker, "tip");
    Object.assign(tip.style, {
      position: "fixed",
      zIndex: "2147483647",
      left: "12px",
      bottom: "12px",
      maxWidth: "min(620px, calc(100vw - 24px))",
      padding: "10px 12px",
      borderRadius: "8px",
      background: "rgba(15, 23, 42, .94)",
      color: "#fff",
      font: "13px/1.45 system-ui, sans-serif",
      boxShadow: "0 8px 30px rgba(0,0,0,.28)",
      pointerEvents: "none",
    });
    tip.textContent = "移动鼠标并单击目标元素；按 Esc 取消。CodeDeck 只会返回 CSS selector 和短预览文本。";
    document.documentElement.appendChild(tip);

    const escapeCss = (value) => globalThis.CSS?.escape
      ? globalThis.CSS.escape(value)
      : String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => "\\\\" + char);
    const stableClasses = (element) => Array.from(element.classList || [])
      .filter((name) => name.length <= 48 && /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name))
      .filter((name) => !/(active|selected|hover|focus|open|show|loading|disabled|error|success|\d{4,})/i.test(name))
      .slice(0, 2);
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const segment = (element) => {
      const tag = element.tagName.toLowerCase();
      if (element.id && !sensitivePattern.test(element.id)) {
        const idSelector = "#" + escapeCss(element.id);
        if (unique(idSelector)) return idSelector;
      }
      const classes = stableClasses(element);
      const classSelector = classes.length
        ? tag + classes.map((name) => "." + escapeCss(name)).join("")
        : tag;
      if (unique(classSelector)) return classSelector;
      const parent = element.parentElement;
      if (!parent) return classSelector;
      const siblings = Array.from(parent.children).filter((item) => item.tagName === element.tagName);
      return siblings.length > 1
        ? classSelector + ":nth-of-type(" + (siblings.indexOf(element) + 1) + ")"
        : classSelector;
    };
    const selectorFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const part = segment(current);
        parts.unshift(part);
        const selector = parts.join(" > ");
        if (unique(selector)) return selector;
        if (part.startsWith("#")) break;
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const isSensitive = (element) => {
      if (forbiddenTags.has(element.tagName)) return true;
      if (element.closest("[" + marker + "]")) return true;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const signature = [element.type, element.name, element.id, element.autocomplete].join(" ");
        return element.type === "password" || sensitivePattern.test(signature);
      }
      return false;
    };
    const previewFor = (element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.tagName.toLowerCase();
      }
      return element.getAttribute("aria-label") || element.textContent || element.tagName.toLowerCase();
    };
    const cleanup = () => {
      hovered?.removeAttribute("data-codedeck-selector-hover");
      document.removeEventListener("mouseover", onHover, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.querySelectorAll("[" + marker + "]").forEach((node) => node.remove());
    };
    const onHover = (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest("[" + marker + "]")) return;
      hovered?.removeAttribute("data-codedeck-selector-hover");
      hovered = element;
      hovered.setAttribute("data-codedeck-selector-hover", "");
    };
    const onClick = (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || isSensitive(element)) {
        tip.textContent = "该元素可能包含敏感内容或不允许选择，请选择其他元素。";
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const selector = selectorFor(element);
      const previewText = String(previewFor(element)).replace(/[\\u0000-\\u001f\\u007f]+/g, " ").replace(/\\s+/g, " ").trim().slice(0, ${MAX_PREVIEW_LENGTH});
      cleanup();
      resolve({ selector, previewText });
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();
      resolve(null);
    };
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }))()`;
}
