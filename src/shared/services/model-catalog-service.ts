export interface ModelCatalogFetchRequest {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ModelCatalogFetchResult {
  models: string[];
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildCandidateUrls(baseUrl: string): string[] {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());
  if (!normalizedBaseUrl) {
    return [];
  }

  let primary = normalizedBaseUrl;
  if (!/\/models$/i.test(primary)) {
    primary = `${primary}/models`;
  }

  const candidates = [primary];
  if (!/\/v1(?:\/models)?$/i.test(normalizedBaseUrl)) {
    candidates.push(`${normalizedBaseUrl}/v1/models`);
  }

  return Array.from(new Set(candidates));
}

function buildHeaders(apiKey: string, authScheme: "bearer" | "x-api-key"): Record<string, string> {
  const trimmedKey = apiKey.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (authScheme === "x-api-key") {
    headers["x-api-key"] = trimmedKey;
  } else {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function collectModels(payload: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown[] }).data)
  ) {
    items = (payload as { data: unknown[] }).data;
  }

  return Array.from(
    new Set(
      items
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }
          if (!item || typeof item !== "object") {
            return "";
          }
          const candidate = [
            (item as { id?: string }).id,
            (item as { name?: string }).name,
            (item as { model?: string }).model,
          ].find((value) => typeof value === "string" && value.trim());
          return candidate?.trim() ?? "";
        })
        .filter(Boolean),
    ),
  );
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return summarizeErrorBody(body);
  } catch {
    return "";
  }
}

function summarizeErrorBody(body: string): string {
  const compactBody = body.replace(/\s+/g, " ").trim();
  if (!compactBody) {
    return "";
  }

  const looksLikeHtml = /<(?:!doctype|html|head|body)\b/i.test(compactBody);
  if (!looksLikeHtml) {
    return compactBody.slice(0, 300);
  }

  if (/cloudflare/i.test(compactBody)) {
    return "站点返回 Cloudflare 拦截页面，无法自动获取模型列表。请完成站点验证或联系服务提供方。";
  }

  const titleMatch = compactBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return title
    ? `站点返回 HTML 错误页：${title.slice(0, 160)}`
    : "站点返回 HTML 错误页，无法自动获取模型列表。";
}

export class ModelCatalogService {
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async fetch(request: ModelCatalogFetchRequest): Promise<ModelCatalogFetchResult> {
    const baseUrl = request.baseUrl.trim();
    const apiKey = request.apiKey.trim();
    if (!baseUrl) {
      throw new Error("Base URL 不能为空");
    }
    if (!apiKey) {
      throw new Error("API Key / Token 不能为空");
    }

    const candidateUrls = buildCandidateUrls(baseUrl);
    const timeoutMs = request.timeoutMs ?? 8000;
    const errors: string[] = [];

    for (const candidateUrl of candidateUrls) {
      for (const authScheme of ["bearer", "x-api-key"] as const) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await this.fetchImpl(candidateUrl, {
            method: "GET",
            headers: buildHeaders(apiKey, authScheme),
            signal: controller.signal,
          });

          if (!response.ok) {
            const detail = await readErrorBody(response);
            errors.push(`${candidateUrl} [${authScheme}] -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
            continue;
          }

          const payload = await response.json();
          return {
            models: collectModels(payload),
          };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            errors.push(`${candidateUrl} [${authScheme}] -> 请求超时`);
          } else {
            errors.push(`${candidateUrl} [${authScheme}] -> ${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    throw new Error(errors.join("；") || "获取模型失败");
  }
}
