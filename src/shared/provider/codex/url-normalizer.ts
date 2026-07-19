// Codex URL 规范化器 — 翻译自 Go internal/provider/codex/command_builder.go
// NormalizeBaseURL + BuildBrowserURL

const API_PATH_SUFFIXES = ["/responses", "/chat/completions", "/completions"];

function normalizeHttpUrl(rawUrl: string, requireValue: boolean = true): string {
  const normalized = rawUrl.trim();
  if (!normalized) {
    if (requireValue) throw new Error("Base URL 不能为空");
    return "";
  }
  const lower = normalized.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    throw new Error("Base URL 必须以 http:// 或 https:// 开头");
  }
  return normalized.replace(/\/+$/, "");
}

/** 移除 URL 末尾的无意义斜杠 */
function cleanTrailingSlash(urlStr: string): string {
  const url = new URL(urlStr);
  if (url.pathname === "/") {
    // 保留 origin，去掉末尾 /
    return urlStr.replace(/\/$/, "");
  }
  return urlStr;
}

/**
 * 规范化 Codex Base URL
 * - 剥离 API 路径后缀（/responses, /chat/completions, /completions）
 * - 自动追加 /v1
 */
export function normalizeCodexUrl(baseUrl: string): string {
  let normalized = normalizeHttpUrl(baseUrl, true);

  // 解析 URL 并处理路径
  const url = new URL(normalized);
  let path = url.pathname.replace(/\/+$/, "");
  const lowered = path.toLowerCase();

  for (const suffix of API_PATH_SUFFIXES) {
    if (lowered.endsWith(suffix)) {
      path = path.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }

  if (!path.toLowerCase().endsWith("/v1")) {
    path = path ? `${path}/v1` : "/v1";
  }

  url.pathname = path;
  return url.toString();
}

/**
 * 构建浏览器 URL（剥离 API 后缀和 /v1）
 */
export function buildCodexBrowserUrl(rawUrl: string): string {
  const normalized = normalizeHttpUrl(rawUrl, true);
  const url = new URL(normalized);
  let path = url.pathname.replace(/\/+$/, "");
  const lowered = path.toLowerCase();

  for (const suffix of API_PATH_SUFFIXES) {
    if (lowered.endsWith(suffix)) {
      path = path.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }

  if (path.toLowerCase().endsWith("/v1")) {
    path = path.slice(0, -3).replace(/\/+$/, "");
  }

  url.pathname = path || "/";
  return cleanTrailingSlash(url.toString());
}