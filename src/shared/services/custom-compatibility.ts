import type { BalanceCheckItem } from "../balance/types.js";
import type { CheckinResult } from "../checkin/types.js";

export type CustomCompatibilityMode = "api" | "page";
export type CustomCredentialForwarding = "none" | "explicit_origin";
export type CustomNumberFormat = "plain" | "comma" | "decimal";

export interface CustomValueSource {
  kind: "json_path" | "css_selector";
  path_or_selector: string;
  attribute?: string;
  regex?: string;
  number_format?: CustomNumberFormat;
}

interface CustomRuleAuthorization {
  credential_forwarding: CustomCredentialForwarding;
  credential_source_origin?: string;
  credential_target_origin?: string;
  confirmed_at?: string;
}

export interface CustomBalanceRule extends CustomRuleAuthorization {
  mode: CustomCompatibilityMode;
  target_url: string;
  method?: "GET" | "POST";
  request_body?: string;
  remaining?: CustomValueSource;
  total?: CustomValueSource;
  used?: CustomValueSource;
  unit?: string;
  success_path?: string;
  page_url?: string;
}

export interface CustomCheckinRule extends CustomRuleAuthorization {
  mode: CustomCompatibilityMode;
  target_url: string;
  method?: "GET" | "POST";
  request_body?: string;
  action_selector?: string;
  success?: CustomValueSource;
  already_checked?: CustomValueSource;
  page_url?: string;
}

export interface SiteCustomCompatibility {
  enabled: true;
  identity_origin?: string;
  login_url?: string;
  identity_mode: "standard" | "user_confirmed";
  balance?: CustomBalanceRule;
  checkin?: CustomCheckinRule;
}

export interface CustomDomElement {
  readonly tagName?: string;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
}

export interface CustomDomRoot {
  querySelector(selector: string): CustomDomElement | null;
}

export type CustomValueInput =
  | { kind: "json"; value: unknown }
  | { kind: "dom"; root: CustomDomRoot };

export type CustomValueExtractionResult =
  | { ok: true; found: boolean; value: unknown }
  | { ok: false; error: string };

export type CustomBalanceMappingResult =
  | { ok: true; item: BalanceCheckItem }
  | { ok: false; error: string };

const MAX_URL_LENGTH = 2_048;
const MAX_PATH_LENGTH = 512;
const MAX_SELECTOR_LENGTH = 1_024;
const MAX_ATTRIBUTE_LENGTH = 128;
const MAX_REGEX_LENGTH = 256;
const MAX_REGEX_INPUT_LENGTH = 4_096;
const MAX_REQUEST_BODY_LENGTH = 16_384;
const MAX_UNIT_LENGTH = 32;
const CHALLENGE_PATTERN = /turnstile|cloudflare|captcha|challenge|人机|验证码|校验/i;
const FALSE_TEXT_PATTERN = /^(?:false|0|no|off|null|undefined|失败|未签到|否)$/i;

export function normalizeSiteCustomCompatibility(value: unknown): SiteCustomCompatibility | undefined {
  if (!isRecord(value) || value.enabled !== true) {
    return undefined;
  }

  const identityMode = value.identity_mode === "user_confirmed" ? "user_confirmed" : "standard";
  const identityOrigin = optionalOrigin(value.identity_origin, "管理/身份 origin");
  const loginUrl = optionalHttpUrl(value.login_url, "浏览器登录 URL");
  if (identityMode === "user_confirmed" && !loginUrl) {
    throw new Error("用户确认身份模式必须配置浏览器登录 URL");
  }

  const balance = value.balance === undefined
    ? undefined
    : normalizeBalanceRule(value.balance);
  const checkin = value.checkin === undefined
    ? undefined
    : normalizeCheckinRule(value.checkin);
  if (!balance && !checkin) {
    throw new Error("启用自定义兼容规则时至少需要配置余额或签到规则");
  }

  return {
    enabled: true,
    ...(identityOrigin ? { identity_origin: identityOrigin } : {}),
    ...(loginUrl ? { login_url: loginUrl } : {}),
    identity_mode: identityMode,
    ...(balance ? { balance } : {}),
    ...(checkin ? { checkin } : {}),
  };
}

export function cloneSiteCustomCompatibility(
  value: SiteCustomCompatibility | undefined,
): SiteCustomCompatibility | undefined {
  if (!value) return undefined;
  return {
    enabled: true,
    ...(value.identity_origin ? { identity_origin: value.identity_origin } : {}),
    ...(value.login_url ? { login_url: value.login_url } : {}),
    identity_mode: value.identity_mode,
    ...(value.balance ? { balance: cloneBalanceRule(value.balance) } : {}),
    ...(value.checkin ? { checkin: cloneCheckinRule(value.checkin) } : {}),
  };
}

export function customCompatibilityEquals(
  left: SiteCustomCompatibility | undefined,
  right: SiteCustomCompatibility | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function parseCustomJsonPath(path: string): Array<string | number> {
  const source = boundedString(path, "JSON 字段路径", MAX_PATH_LENGTH);
  const tokens: Array<string | number> = [];
  let index = 0;

  if (source[index] === "$") {
    index += 1;
    if (index < source.length && source[index] !== "." && source[index] !== "[") {
      throw new Error("JSON 字段路径的 $ 后必须是点号或括号");
    }
  }

  while (index < source.length) {
    if (source[index] === ".") {
      index += 1;
      if (index >= source.length) throw new Error("JSON 字段路径不能以点号结尾");
    }

    if (source[index] === "[") {
      const parsed = parseBracketToken(source, index);
      tokens.push(parsed.token);
      index = parsed.nextIndex;
      continue;
    }

    const start = index;
    while (index < source.length && source[index] !== "." && source[index] !== "[") {
      if (source[index] === "]") throw new Error("JSON 字段路径包含未配对的 ]");
      index += 1;
    }
    const key = source.slice(start, index).trim();
    if (!key) throw new Error("JSON 字段路径包含空字段");
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)) {
      throw new Error(`JSON 字段路径字段无效：${key}`);
    }
    tokens.push(key);
  }

  if (tokens.length === 0) throw new Error("JSON 字段路径不能为空");
  return tokens;
}

export function readCustomJsonPath(payload: unknown, path: string): CustomValueExtractionResult {
  let tokens: Array<string | number>;
  try {
    tokens = parseCustomJsonPath(path);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  let current = payload;
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token >= current.length) {
        return { ok: true, found: false, value: undefined };
      }
      current = current[token];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) {
      return { ok: true, found: false, value: undefined };
    }
    current = current[token];
  }
  return { ok: true, found: true, value: current };
}

export function extractCustomValue(
  input: CustomValueInput,
  source: CustomValueSource,
): CustomValueExtractionResult {
  let extracted: CustomValueExtractionResult;
  if (input.kind === "json") {
    if (source.kind !== "json_path") {
      return { ok: false, error: "JSON 响应只能使用 JSON 字段路径" };
    }
    extracted = readCustomJsonPath(input.value, source.path_or_selector);
  } else {
    if (source.kind !== "css_selector") {
      return { ok: false, error: "网页响应只能使用 CSS selector" };
    }
    extracted = readCustomDomValue(input.root, source);
  }

  if (!extracted.ok || !extracted.found || !source.regex) return extracted;
  const text = stringifyCustomValue(extracted.value).slice(0, MAX_REGEX_INPUT_LENGTH);
  try {
    const match = new RegExp(source.regex, "u").exec(text);
    return match
      ? { ok: true, found: true, value: match[1] ?? match[0] }
      : { ok: true, found: false, value: undefined };
  } catch {
    return { ok: false, error: "配置的正则表达式无效" };
  }
}

export function mapCustomBalanceItem(
  input: CustomValueInput,
  rule: CustomBalanceRule,
): CustomBalanceMappingResult {
  if (input.kind === "json" && rule.success_path) {
    const success = readCustomJsonPath(input.value, rule.success_path);
    if (!success.ok) return success;
    if (!success.found || !customValueMatches(success.value, success.found, false)) {
      return { ok: false, error: `余额响应成功字段未通过：${rule.success_path}` };
    }
  }

  const values: Record<"remaining" | "total" | "used", number | null> = {
    remaining: null,
    total: null,
    used: null,
  };
  for (const field of ["remaining", "total", "used"] as const) {
    const source = rule[field];
    if (!source) continue;
    const extracted = extractCustomValue(input, source);
    if (!extracted.ok) return extracted;
    if (!extracted.found) {
      return { ok: false, error: `未找到配置的余额字段：${field}` };
    }
    const number = parseCustomNumber(extracted.value, source.number_format ?? "plain");
    if (number === null) {
      return { ok: false, error: `余额字段无法解析为数字：${field}` };
    }
    values[field] = number;
  }

  if (values.remaining === null && values.total === null && values.used === null) {
    return { ok: false, error: "自定义余额规则没有可用的数值映射" };
  }
  if (values.remaining === null && values.total !== null && values.used !== null) {
    values.remaining = values.total - values.used;
  } else if (values.total === null && values.remaining !== null && values.used !== null) {
    values.total = values.remaining + values.used;
  } else if (values.used === null && values.total !== null && values.remaining !== null) {
    values.used = values.total - values.remaining;
  }

  const unit = rule.unit?.trim() ?? "";
  return {
    ok: true,
    item: {
      label: unit || "余额",
      remaining: values.remaining,
      total: values.total,
      used: values.used,
      unit,
    },
  };
}

export function classifyCustomCheckinResult(
  rule: CustomCheckinRule,
  input: CustomValueInput,
  options: { bodyText?: string; httpStatus?: number } = {},
): CheckinResult {
  const endpoint = rule.target_url;
  const already = classifyConfiguredSource(input, rule.already_checked);
  if (!already.ok) return customCheckinFailure(endpoint, already.error);
  if (already.matched) {
    return { status: "already_checked", success: true, message: "今日已签到", endpoint };
  }

  const success = classifyConfiguredSource(input, rule.success);
  if (!success.ok) return customCheckinFailure(endpoint, success.error);
  if (success.matched) {
    return { status: "success", success: true, message: "签到成功", endpoint };
  }

  const bodyText = options.bodyText?.slice(0, MAX_REGEX_INPUT_LENGTH) ?? "";
  if (CHALLENGE_PATTERN.test(bodyText)) {
    return {
      status: "manual_required",
      success: false,
      message: "签到需要人工验证",
      endpoint,
      manual_url: rule.page_url ?? rule.target_url,
      error_code: "turnstile_required",
    };
  }
  if (options.httpStatus === 401 || options.httpStatus === 403) {
    return {
      status: "login_required",
      success: false,
      message: "自定义签到规则鉴权失败",
      endpoint,
      error_code: "auth_not_logged_in",
    };
  }
  return customCheckinFailure(
    endpoint,
    options.httpStatus && options.httpStatus >= 400
      ? `自定义签到请求失败（HTTP ${options.httpStatus}）`
      : "未匹配到配置的签到成功状态",
  );
}

export function isCustomCredentialForwardingAuthorized(
  rule: CustomBalanceRule | CustomCheckinRule,
  sourceOrigin: string,
  targetUrl: string,
): boolean {
  if (
    rule.credential_forwarding !== "explicit_origin"
    || !rule.credential_source_origin
    || !rule.credential_target_origin
    || !rule.confirmed_at
  ) {
    return false;
  }
  try {
    return normalizeOrigin(sourceOrigin, "凭据来源 origin") === rule.credential_source_origin
      && normalizeOrigin(targetUrl, "凭据目标 origin") === rule.credential_target_origin
      && normalizeOrigin(rule.target_url, "规则目标 URL") === rule.credential_target_origin
      && Number.isFinite(Date.parse(rule.confirmed_at));
  } catch {
    return false;
  }
}

export function isCustomCredentialForwardingAllowed(
  rule: CustomBalanceRule | CustomCheckinRule,
  sourceOrigin: string,
  targetUrl: string,
): boolean {
  try {
    if (normalizeOrigin(sourceOrigin, "凭据来源 origin") === normalizeOrigin(targetUrl, "规则目标 URL")) {
      return true;
    }
  } catch {
    return false;
  }
  return isCustomCredentialForwardingAuthorized(rule, sourceOrigin, targetUrl);
}

function normalizeBalanceRule(value: unknown): CustomBalanceRule {
  if (!isRecord(value)) throw new Error("余额规则格式无效");
  const mode = normalizeMode(value.mode, "余额");
  const targetUrl = requiredHttpUrl(value.target_url ?? value.page_url, "余额目标 URL");
  const pageUrl = optionalHttpUrl(value.page_url, "余额页面 URL");
  const method = normalizeMethod(value.method, mode === "api" ? "GET" : "GET");
  const requestBody = optionalBoundedString(value.request_body, "余额请求体", MAX_REQUEST_BODY_LENGTH);
  if (method === "GET" && requestBody) throw new Error("GET 余额规则不能配置请求体");

  const remaining = optionalValueSource(value.remaining, "余额剩余字段", mode);
  const total = optionalValueSource(value.total, "余额总额字段", mode);
  const used = optionalValueSource(value.used, "余额已用字段", mode);
  if (!remaining && !total && !used) {
    throw new Error("余额规则至少需要配置剩余、总额或已用字段之一");
  }
  if (mode === "page" && !pageUrl && !targetUrl) {
    throw new Error("网页余额规则必须配置页面 URL");
  }

  const successPath = optionalBoundedString(value.success_path, "余额成功字段", MAX_PATH_LENGTH);
  if (successPath) parseCustomJsonPath(successPath);
  if (mode === "page" && successPath) throw new Error("网页余额规则不能使用 JSON 成功字段");
  const unit = optionalBoundedString(value.unit, "余额单位", MAX_UNIT_LENGTH);
  const authorization = normalizeAuthorization(value, targetUrl);
  return {
    mode,
    target_url: targetUrl,
    method,
    ...(requestBody ? { request_body: requestBody } : {}),
    ...(remaining ? { remaining } : {}),
    ...(total ? { total } : {}),
    ...(used ? { used } : {}),
    ...(unit ? { unit } : {}),
    ...(successPath ? { success_path: successPath } : {}),
    ...(pageUrl ? { page_url: pageUrl } : mode === "page" ? { page_url: targetUrl } : {}),
    ...authorization,
  };
}

function normalizeCheckinRule(value: unknown): CustomCheckinRule {
  if (!isRecord(value)) throw new Error("签到规则格式无效");
  const mode = normalizeMode(value.mode, "签到");
  const targetUrl = requiredHttpUrl(value.target_url ?? value.page_url, "签到目标 URL");
  const pageUrl = optionalHttpUrl(value.page_url, "签到页面 URL");
  const method = normalizeMethod(value.method, mode === "api" ? "POST" : "GET");
  const requestBody = optionalBoundedString(value.request_body, "签到请求体", MAX_REQUEST_BODY_LENGTH);
  if (method === "GET" && requestBody) throw new Error("GET 签到规则不能配置请求体");

  const actionSelector = optionalBoundedString(value.action_selector, "签到按钮 selector", MAX_SELECTOR_LENGTH);
  if (mode === "page" && !actionSelector) throw new Error("网页签到规则必须配置签到按钮 selector");
  if (mode === "api" && actionSelector) throw new Error("API 签到规则不能配置网页按钮 selector");
  const success = optionalValueSource(value.success, "签到成功字段", mode);
  const alreadyChecked = optionalValueSource(value.already_checked, "已签到字段", mode);
  if (!success) throw new Error("签到规则必须配置成功判定字段或元素");

  const authorization = normalizeAuthorization(value, targetUrl);
  return {
    mode,
    target_url: targetUrl,
    method,
    ...(requestBody ? { request_body: requestBody } : {}),
    ...(actionSelector ? { action_selector: actionSelector } : {}),
    ...(success ? { success } : {}),
    ...(alreadyChecked ? { already_checked: alreadyChecked } : {}),
    ...(pageUrl ? { page_url: pageUrl } : mode === "page" ? { page_url: targetUrl } : {}),
    ...authorization,
  };
}

function normalizeAuthorization(
  value: Record<string, unknown>,
  targetUrl: string,
): CustomRuleAuthorization {
  if (value.credential_forwarding !== "explicit_origin") {
    return { credential_forwarding: "none" };
  }

  const sourceOrigin = optionalOrigin(value.credential_source_origin, "凭据来源 origin");
  const savedTargetOrigin = optionalOrigin(value.credential_target_origin, "凭据目标 origin");
  const targetOrigin = normalizeOrigin(targetUrl, "规则目标 URL");
  const confirmedAt = normalizeConfirmedAt(value.confirmed_at);
  if (!sourceOrigin || !savedTargetOrigin || savedTargetOrigin !== targetOrigin || !confirmedAt) {
    return { credential_forwarding: "none" };
  }
  return {
    credential_forwarding: "explicit_origin",
    credential_source_origin: sourceOrigin,
    credential_target_origin: savedTargetOrigin,
    confirmed_at: confirmedAt,
  };
}

function optionalValueSource(
  value: unknown,
  label: string,
  mode: CustomCompatibilityMode,
): CustomValueSource | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error(`${label}格式无效`);
  const expectedKind = mode === "api" ? "json_path" : "css_selector";
  if (value.kind !== expectedKind) {
    throw new Error(`${label}必须使用${mode === "api" ? " JSON 字段路径" : " CSS selector"}`);
  }
  const maxLength = expectedKind === "json_path" ? MAX_PATH_LENGTH : MAX_SELECTOR_LENGTH;
  const pathOrSelector = boundedString(value.path_or_selector, label, maxLength);
  if (expectedKind === "json_path") parseCustomJsonPath(pathOrSelector);
  const attribute = optionalBoundedString(value.attribute, `${label}属性`, MAX_ATTRIBUTE_LENGTH);
  if (attribute && expectedKind !== "css_selector") throw new Error(`${label}的属性读取仅适用于网页元素`);
  if (attribute && !/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(attribute)) {
    throw new Error(`${label}的属性名无效`);
  }
  const regex = optionalBoundedString(value.regex, `${label}正则`, MAX_REGEX_LENGTH);
  if (regex) {
    try {
      new RegExp(regex, "u");
    } catch {
      throw new Error(`${label}正则表达式无效`);
    }
  }
  const numberFormat = value.number_format === "comma" || value.number_format === "decimal"
    ? value.number_format
    : "plain";
  return {
    kind: expectedKind,
    path_or_selector: pathOrSelector,
    ...(attribute ? { attribute } : {}),
    ...(regex ? { regex } : {}),
    number_format: numberFormat,
  };
}

function readCustomDomValue(
  root: CustomDomRoot,
  source: CustomValueSource,
): CustomValueExtractionResult {
  let element: CustomDomElement | null;
  try {
    element = root.querySelector(source.path_or_selector);
  } catch {
    return { ok: false, error: `CSS selector 无效：${source.path_or_selector}` };
  }
  if (!element) return { ok: true, found: false, value: undefined };
  if (isSensitiveElement(element, source.attribute)) {
    return { ok: false, error: "规则不能读取密码、令牌或其他敏感输入元素" };
  }
  if (source.attribute) {
    const value = element.getAttribute(source.attribute);
    return value === null
      ? { ok: true, found: false, value: undefined }
      : { ok: true, found: true, value };
  }
  return { ok: true, found: true, value: element.textContent ?? "" };
}

function parseCustomNumber(value: unknown, format: CustomNumberFormat): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = stringifyCustomValue(value).trim().replace(/[\s\u00a0]/g, "");
  if (!text) return null;

  const candidate = text.match(/[+-]?(?:\d[\d.,]*|[.,]\d+)/)?.[0];
  if (!candidate) return null;
  text = candidate;
  if (format === "comma") {
    text = text.replace(/,/g, "");
  } else if (format === "decimal") {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma > lastDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (lastDot >= 0) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  } else if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyConfiguredSource(
  input: CustomValueInput,
  source: CustomValueSource | undefined,
): { ok: true; matched: boolean } | { ok: false; error: string } {
  if (!source) return { ok: true, matched: false };
  const extracted = extractCustomValue(input, source);
  if (!extracted.ok) return extracted;
  return {
    ok: true,
    matched: customValueMatches(
      extracted.value,
      extracted.found,
      input.kind === "dom" && source.kind === "css_selector" && !source.regex,
    ),
  };
}

function customValueMatches(value: unknown, found: boolean, emptyTextMatches: boolean): boolean {
  if (!found) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (value === null || value === undefined) return false;
  const text = stringifyCustomValue(value).trim();
  if (!text) return emptyTextMatches;
  return !FALSE_TEXT_PATTERN.test(text);
}

function customCheckinFailure(endpoint: string, message: string): CheckinResult {
  return {
    status: "failed",
    success: false,
    message,
    endpoint,
    error_code: "business_rejected",
  };
}

function normalizeMode(value: unknown, label: string): CustomCompatibilityMode {
  if (value === "api" || value === "page") return value;
  throw new Error(`${label}规则类型必须是 API 或网页`);
}

function normalizeMethod(value: unknown, fallback: "GET" | "POST"): "GET" | "POST" {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (normalized === "GET" || normalized === "POST") return normalized;
  throw new Error("自定义规则请求方法只支持 GET 或 POST");
}

function requiredHttpUrl(value: unknown, label: string): string {
  return normalizeHttpUrl(boundedString(value, label, MAX_URL_LENGTH), label);
}

function optionalHttpUrl(value: unknown, label: string): string | undefined {
  const normalized = optionalBoundedString(value, label, MAX_URL_LENGTH);
  return normalized ? normalizeHttpUrl(normalized, label) : undefined;
}

function normalizeHttpUrl(value: string, label: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${label}必须是完整的 http:// 或 https:// URL`);
  }
}

function normalizeOrigin(value: string, label: string): string {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.origin;
  } catch {
    throw new Error(`${label}必须是有效的 http:// 或 https:// origin`);
  }
}

function optionalOrigin(value: unknown, label: string): string | undefined {
  const normalized = optionalBoundedString(value, label, MAX_URL_LENGTH);
  return normalized ? normalizeOrigin(normalized, label) : undefined;
}

function normalizeConfirmedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label}长度不能超过 ${maxLength} 个字符`);
  return normalized;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, label, maxLength);
}

function parseBracketToken(
  source: string,
  startIndex: number,
): { token: string | number; nextIndex: number } {
  let index = startIndex + 1;
  while (source[index] === " ") index += 1;
  const quote = source[index];
  if (quote === "\"" || quote === "'") {
    index += 1;
    let key = "";
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\") {
        index += 1;
        if (index >= source.length) throw new Error("JSON 字段路径字符串转义无效");
      }
      key += source[index];
      index += 1;
    }
    if (source[index] !== quote) throw new Error("JSON 字段路径字符串未闭合");
    index += 1;
    while (source[index] === " ") index += 1;
    if (source[index] !== "]") throw new Error("JSON 字段路径括号未闭合");
    if (!key) throw new Error("JSON 字段路径包含空字段");
    return { token: key, nextIndex: index + 1 };
  }

  const numberStart = index;
  while (/\d/.test(source[index] ?? "")) index += 1;
  const rawIndex = source.slice(numberStart, index);
  while (source[index] === " ") index += 1;
  if (!rawIndex || source[index] !== "]") {
    throw new Error("JSON 字段路径括号只支持数组索引或引号字段名");
  }
  const arrayIndex = Number(rawIndex);
  if (!Number.isSafeInteger(arrayIndex)) throw new Error("JSON 字段路径数组索引无效");
  return { token: arrayIndex, nextIndex: index + 1 };
}

function isSensitiveElement(element: CustomDomElement, attribute: string | undefined): boolean {
  const tagName = element.tagName?.toLowerCase() ?? "";
  const inputType = element.getAttribute("type")?.toLowerCase() ?? "";
  const name = [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("autocomplete"),
  ].filter(Boolean).join(" ");
  return (tagName === "input" && inputType === "password")
    || /password|passwd|token|secret|authorization|otp|captcha/i.test(name)
    || (tagName === "input" && attribute?.toLowerCase() === "value");
}

function cloneValueSource(source: CustomValueSource): CustomValueSource {
  return { ...source };
}

function cloneBalanceRule(rule: CustomBalanceRule): CustomBalanceRule {
  return {
    ...rule,
    ...(rule.remaining ? { remaining: cloneValueSource(rule.remaining) } : {}),
    ...(rule.total ? { total: cloneValueSource(rule.total) } : {}),
    ...(rule.used ? { used: cloneValueSource(rule.used) } : {}),
  };
}

function cloneCheckinRule(rule: CustomCheckinRule): CustomCheckinRule {
  return {
    ...rule,
    ...(rule.success ? { success: cloneValueSource(rule.success) } : {}),
    ...(rule.already_checked ? { already_checked: cloneValueSource(rule.already_checked) } : {}),
  };
}

function stringifyCustomValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
