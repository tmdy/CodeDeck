import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";
import type {
  CustomBalanceRule,
  CustomCheckinRule,
  CustomDomElement,
  CustomDomRoot,
  CustomValueSource,
} from "../services/custom-compatibility.js";
import type { CustomCompatibilityPageTransport } from "../services/custom-compatibility-executor.js";

export interface CustomCompatibilityPageServiceDependencies {
  createSession: (partition: string) => Session;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getParentWindow?: () => BrowserWindow | null;
  windowIcon?: string;
  pollIntervalMs?: number;
}

interface ElementSnapshot {
  selector: string;
  found: boolean;
  tagName: string;
  textContent: string;
  attributes: Record<string, string | null>;
}

interface PageSnapshot {
  challengeDetected: boolean;
  elements: ElementSnapshot[];
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const PAGE_TEXT_LIMIT = 4_096;
const SENSITIVE_ATTRIBUTE_PATTERN = /^(?:value|password|passwd|token|secret|authorization|cookie|session)$/i;

export class CustomCompatibilityPageService {
  private readonly configuredSessions = new WeakSet<Session>();
  private readonly pollIntervalMs: number;

  constructor(private readonly dependencies: CustomCompatibilityPageServiceDependencies) {
    this.pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  createTransport(partition: string): CustomCompatibilityPageTransport {
    return {
      readBalance: (rule, timeoutMs) => this.readBalance(partition, rule, timeoutMs),
      runCheckin: (rule, timeoutMs) => this.runCheckin(partition, rule, timeoutMs),
    };
  }

  private async readBalance(
    partition: string,
    rule: CustomBalanceRule,
    timeoutMs: number,
  ): Promise<CustomDomRoot> {
    const sources = [rule.remaining, rule.total, rule.used].filter(
      (source): source is CustomValueSource => Boolean(source),
    );
    validatePageSources(sources);
    return this.withPage(
      partition,
      rule.page_url ?? rule.target_url,
      timeoutMs,
      async (browserWindow) => {
        const snapshot = await inspectPage(browserWindow, sources);
        return buildSnapshotDomRoot(snapshot.elements);
      },
    );
  }

  private async runCheckin(
    partition: string,
    rule: CustomCheckinRule,
    timeoutMs: number,
  ): Promise<{ root: CustomDomRoot; challengeDetected: boolean }> {
    const sources = [rule.success, rule.already_checked].filter(
      (source): source is CustomValueSource => Boolean(source),
    );
    validatePageSources(sources);
    return this.withPage(
      partition,
      rule.page_url ?? rule.target_url,
      timeoutMs,
      async (browserWindow, deadline) => {
        let snapshot = await inspectPage(browserWindow, sources);
        if (snapshot.challengeDetected || snapshotMatches(snapshot, rule.already_checked)) {
          return {
            root: buildSnapshotDomRoot(snapshot.elements),
            challengeDetected: snapshot.challengeDetected,
          };
        }

        const clicked = await browserWindow.webContents.executeJavaScript(
          buildClickScript(rule.action_selector ?? ""),
          true,
        );
        if (clicked !== true) {
          throw new Error(`未找到或无法点击配置的签到按钮：${rule.action_selector ?? ""}`);
        }

        while (Date.now() < deadline) {
          await delay(Math.min(this.pollIntervalMs, Math.max(1, deadline - Date.now())));
          snapshot = await inspectPage(browserWindow, sources);
          if (
            snapshot.challengeDetected
            || snapshotMatches(snapshot, rule.success)
            || snapshotMatches(snapshot, rule.already_checked)
          ) {
            break;
          }
        }
        return {
          root: buildSnapshotDomRoot(snapshot.elements),
          challengeDetected: snapshot.challengeDetected,
        };
      },
    );
  }

  private async withPage<T>(
    partition: string,
    rawPageUrl: string,
    timeoutMs: number,
    operation: (browserWindow: BrowserWindow, deadline: number) => Promise<T>,
  ): Promise<T> {
    const pageUrl = normalizeHttpUrl(rawPageUrl);
    const allowedOrigin = new URL(pageUrl).origin;
    const browserSession = this.dependencies.createSession(partition);
    this.configureSession(browserSession);
    const browserWindow = this.dependencies.createWindow(this.buildWindowOptions(partition));
    configureWindowSecurity(browserWindow, allowedOrigin);
    const deadline = Date.now() + Math.max(1, timeoutMs);
    try {
      await withDeadline(
        browserWindow.loadURL(pageUrl),
        deadline,
        () => browserWindow.webContents.stop(),
      );
      return await withDeadline(operation(browserWindow, deadline), deadline);
    } finally {
      if (!browserWindow.isDestroyed()) browserWindow.close();
    }
  }

  private configureSession(browserSession: Session): void {
    if (this.configuredSessions.has(browserSession)) return;
    this.configuredSessions.add(browserSession);
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    browserSession.on("will-download", (event) => event.preventDefault());
  }

  private buildWindowOptions(partition: string): BrowserWindowConstructorOptions {
    const parent = this.dependencies.getParentWindow?.() ?? undefined;
    return {
      title: "CodeDeck 自定义兼容规则",
      width: 1000,
      height: 760,
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

export function buildSnapshotDomRoot(elements: ElementSnapshot[]): CustomDomRoot {
  const bySelector = new Map(elements.map((element) => [element.selector, element]));
  return {
    querySelector(selector: string): CustomDomElement | null {
      const snapshot = bySelector.get(selector);
      if (!snapshot?.found) return null;
      return {
        tagName: snapshot.tagName,
        textContent: snapshot.textContent,
        getAttribute(name: string): string | null {
          return Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
            ? snapshot.attributes[name]
            : null;
        },
      };
    },
  };
}

export function isAllowedCustomPageNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}

function configureWindowSecurity(browserWindow: BrowserWindow, allowedOrigin: string): void {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedCustomPageNavigation(targetUrl, allowedOrigin)) event.preventDefault();
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isAllowedCustomPageNavigation(targetUrl, allowedOrigin)) event.preventDefault();
  });
  browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

async function inspectPage(
  browserWindow: BrowserWindow,
  sources: CustomValueSource[],
): Promise<PageSnapshot> {
  const result = await browserWindow.webContents.executeJavaScript(
    buildInspectionScript(sources),
    true,
  );
  return normalizePageSnapshot(result, sources);
}

function normalizePageSnapshot(value: unknown, sources: CustomValueSource[]): PageSnapshot {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawElements = Array.isArray(record.elements) ? record.elements : [];
  const sourceBySelector = new Map(sources.map((source) => [source.path_or_selector, source]));
  const elements = rawElements.flatMap((item): ElementSnapshot[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const element = item as Record<string, unknown>;
    const selector = typeof element.selector === "string" ? element.selector : "";
    const source = sourceBySelector.get(selector);
    if (!source) return [];
    const attributes = element.attributes && typeof element.attributes === "object" && !Array.isArray(element.attributes)
      ? Object.fromEntries(Object.entries(element.attributes as Record<string, unknown>).map(([name, raw]) => [
          name,
          typeof raw === "string" ? raw.slice(0, PAGE_TEXT_LIMIT) : null,
        ]))
      : {};
    return [{
      selector,
      found: element.found === true,
      tagName: typeof element.tagName === "string" ? element.tagName.slice(0, 32) : "",
      textContent: typeof element.textContent === "string"
        ? element.textContent.slice(0, PAGE_TEXT_LIMIT)
        : "",
      attributes,
    }];
  });
  for (const source of sources) {
    if (!elements.some((item) => item.selector === source.path_or_selector)) {
      elements.push({
        selector: source.path_or_selector,
        found: false,
        tagName: "",
        textContent: "",
        attributes: {},
      });
    }
  }
  return { challengeDetected: record.challengeDetected === true, elements };
}

function snapshotMatches(snapshot: PageSnapshot, source: CustomValueSource | undefined): boolean {
  if (!source) return false;
  const element = snapshot.elements.find((item) => item.selector === source.path_or_selector);
  if (!element?.found) return false;
  const raw = source.attribute ? element.attributes[source.attribute] : element.textContent;
  if (raw === null || raw === undefined) return false;
  const text = String(raw).trim();
  if (source.regex) {
    try {
      return new RegExp(source.regex, "u").test(text);
    } catch {
      return false;
    }
  }
  return !/^(?:false|0|no|off|null|undefined|失败|未签到|否)$/i.test(text);
}

function validatePageSources(sources: CustomValueSource[]): void {
  for (const source of sources) {
    if (source.kind !== "css_selector") {
      throw new Error("网页规则只能使用 CSS selector");
    }
    if (source.attribute && SENSITIVE_ATTRIBUTE_PATTERN.test(source.attribute)) {
      throw new Error(`规则不能读取敏感属性：${source.attribute}`);
    }
  }
}

function buildInspectionScript(sources: CustomValueSource[]): string {
  const descriptors = sources.map((source) => ({
    selector: source.path_or_selector,
    attribute: source.attribute ?? "",
  }));
  return `(() => {
    const descriptors = ${JSON.stringify(descriptors)};
    const challengePattern = /turnstile|cloudflare|captcha|challenge|人机|验证码|校验/i;
    const pageSignal = [
      document.title || "",
      (document.body?.innerText || "").slice(0, 50000),
      ...Array.from(document.querySelectorAll("iframe[src]")).map((frame) => frame.getAttribute("src") || ""),
    ].join(" ");
    return {
      challengeDetected: challengePattern.test(pageSignal),
      elements: descriptors.map(({ selector, attribute }) => {
        let element = null;
        try { element = document.querySelector(selector); } catch { element = null; }
        if (!element) return { selector, found: false, tagName: "", textContent: "", attributes: {} };
        const attributeNames = new Set(["type", "name", "id", "autocomplete"]);
        if (attribute) attributeNames.add(attribute);
        const attributes = {};
        for (const name of attributeNames) attributes[name] = element.getAttribute(name);
        return {
          selector,
          found: true,
          tagName: element.tagName,
          textContent: String(element.textContent || "").slice(0, ${PAGE_TEXT_LIMIT}),
          attributes,
        };
      }),
    };
  })()`;
}

function buildClickScript(selector: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const sensitivePattern = /pass(word)?|secret|token|authorization|cookie|session|credential|api[-_ ]?key/i;
    let element = null;
    try { element = document.querySelector(selector); } catch { return false; }
    if (!element || !(element instanceof HTMLElement)) return false;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(element.tagName)) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const signature = [element.type, element.name, element.id, element.autocomplete].join(" ");
      if (element.type === "password" || sensitivePattern.test(signature)) return false;
    }
    element.click();
    return true;
  })()`;
}

function normalizeHttpUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("自定义页面 URL 格式无效");
  }
}

function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  onTimeout?: () => void,
): Promise<T> {
  const remaining = Math.max(1, deadline - Date.now());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* Ignore shutdown races. */ }
      reject(new Error("自定义页面操作超时"));
    }, remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}
