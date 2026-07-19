import {
  BrowserWindow,
  session as electronSession,
  type Session,
} from "electron";
import { createHash, randomUUID } from "node:crypto";

interface ChromiumFetchContext {
  partition: string;
  session: Session;
  solving: Promise<void> | null;
}

const JAVASCRIPT_CHALLENGE_PATTERN = /(?:acw_sc__v2|var\s+arg1\s*=|document\.cookie)/i;
const INTERACTIVE_CHALLENGE_PATTERN = /(?:cloudflare|turnstile|captcha|just a moment|人机验证|验证码)/i;

export function isJavascriptChallengeHtml(body: string): boolean {
  return /<html|<!doctype html/i.test(body) && JAVASCRIPT_CHALLENGE_PATTERN.test(body);
}

export function isInteractiveChallengeHtml(body: string): boolean {
  return /<html|<!doctype html/i.test(body) && INTERACTIVE_CHALLENGE_PATTERN.test(body);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function sameOrigin(candidate: string, allowedOrigin: string): boolean {
  try {
    return new URL(candidate).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function headersForRequest(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

function contextKey(url: string, init?: RequestInit): string {
  const headers = headersForRequest(init);
  const credentialScope = `${headers.get("authorization") ?? ""}\0${headers.get("cookie") ?? ""}`;
  const credentialHash = createHash("sha256").update(credentialScope).digest("hex").slice(0, 16);
  return `${new URL(url).origin}::${credentialHash}`;
}

function parseCookieHeader(value: string): Array<{ name: string; value: string }> {
  return value.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return [];
    }
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    return name ? [{ name, value: cookieValue }] : [];
  });
}

async function applyExplicitCookies(
  targetSession: Session,
  url: string,
  headers: Headers,
): Promise<Headers> {
  const rawCookie = headers.get("cookie");
  if (!rawCookie) {
    return headers;
  }
  const cookies = parseCookieHeader(rawCookie);
  const explicitNames = new Set(cookies.map((cookie) => cookie.name.toLowerCase()));
  for (const managedName of ["session", "token"]) {
    if (explicitNames.has(managedName)) {
      continue;
    }
    for (const current of await targetSession.cookies.get({ url, name: managedName })) {
      await targetSession.cookies.remove(url, current.name);
    }
  }
  for (const cookie of cookies) {
    await targetSession.cookies.set({
      url: new URL(url).origin,
      name: cookie.name,
      value: cookie.value,
      path: "/",
      secure: new URL(url).protocol === "https:",
    });
  }
  const nextHeaders = new Headers(headers);
  nextHeaders.delete("cookie");
  return nextHeaders;
}

async function waitForJsonDocument(window: BrowserWindow, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!window.isDestroyed() && Date.now() < deadline) {
    try {
      const text = await window.webContents.executeJavaScript(
        "document.body?.innerText?.trim().slice(0, 32) || ''",
        true,
      ) as unknown;
      if (typeof text === "string" && (text.startsWith("{") || text.startsWith("["))) {
        return;
      }
    } catch {
      // The challenge commonly replaces the document while it computes its Cookie.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
}

async function solveJavascriptChallenge(
  context: ChromiumFetchContext,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const allowedOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      partition: context.partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!sameOrigin(navigationUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-redirect", (event, navigationUrl) => {
    if (!sameOrigin(navigationUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });
  try {
    await Promise.race([
      (async () => {
        await window.loadURL(url).catch(() => undefined);
        await waitForJsonDocument(window, timeoutMs);
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

export function createChromiumFetch(challengeTimeoutMs: number = 8_000): typeof fetch {
  const contexts = new Map<string, ChromiumFetchContext>();

  const getContext = (url: string, init?: RequestInit): ChromiumFetchContext => {
    const key = contextKey(url, init);
    const current = contexts.get(key);
    if (current) {
      return current;
    }
    const partition = `codedeck-site-fetch-${randomUUID()}`;
    const targetSession = electronSession.fromPartition(partition, { cache: false });
    targetSession.setPermissionCheckHandler(() => false);
    targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    targetSession.on("will-download", (event) => event.preventDefault());
    const created: ChromiumFetchContext = {
      partition,
      session: targetSession,
      solving: null,
    };
    contexts.set(key, created);
    return created;
  };

  return (async (input, init) => {
    const url = requestUrl(input);
    const context = getContext(url, init);
    const fetchWithSession = async () => {
      const headers = await applyExplicitCookies(
        context.session,
        url,
        headersForRequest(init),
      );
      return context.session.fetch(
        url,
        {
          ...init,
          headers,
          credentials: "include",
        },
      ) as ReturnType<typeof fetch>;
    };

    const response = await fetchWithSession();
    let body = "";
    try {
      body = await response.clone().text();
    } catch {
      return response;
    }
    if (!isJavascriptChallengeHtml(body) || isInteractiveChallengeHtml(body)) {
      return response;
    }

    if (!context.solving) {
      context.solving = solveJavascriptChallenge(context, url, challengeTimeoutMs)
        .finally(() => {
          context.solving = null;
        });
    }
    await context.solving;
    return fetchWithSession();
  }) as typeof fetch;
}
