import { describe, expect, it } from "vitest";
import {
  classifyCustomCheckinResult,
  extractCustomValue,
  isCustomCredentialForwardingAuthorized,
  mapCustomBalanceItem,
  normalizeSiteCustomCompatibility,
  parseCustomJsonPath,
  readCustomJsonPath,
  type CustomBalanceRule,
  type CustomCheckinRule,
  type CustomDomRoot,
} from "../../services/custom-compatibility.js";

function normalizedBalanceRule(value: unknown): CustomBalanceRule {
  const compatibility = normalizeSiteCustomCompatibility({
    enabled: true,
    identity_mode: "standard",
    balance: value,
  });
  if (!compatibility?.balance) throw new Error("balance rule was not normalized");
  return compatibility.balance;
}

function normalizedCheckinRule(value: unknown): CustomCheckinRule {
  const compatibility = normalizeSiteCustomCompatibility({
    enabled: true,
    identity_mode: "standard",
    checkin: value,
  });
  if (!compatibility?.checkin) throw new Error("check-in rule was not normalized");
  return compatibility.checkin;
}

function domRoot(elements: Record<string, {
  textContent?: string;
  tagName?: string;
  attributes?: Record<string, string>;
}>): CustomDomRoot {
  return {
    querySelector(selector) {
      const element = elements[selector];
      if (!element) return null;
      return {
        tagName: element.tagName,
        textContent: element.textContent ?? "",
        getAttribute(name) {
          return element.attributes?.[name] ?? null;
        },
      };
    },
  };
}

describe("custom compatibility", () => {
  it("normalizes declarative API rules and exact-origin credential confirmation", () => {
    const normalized = normalizeSiteCustomCompatibility({
      enabled: true,
      identity_origin: "https://identity.example.com/account",
      login_url: "https://login.example.com/sign-in",
      identity_mode: "standard",
      balance: {
        mode: "api",
        target_url: "https://balance.example.com/api/balance",
        remaining: {
          kind: "json_path",
          path_or_selector: " data.wallet.remaining ",
        },
        unit: " USD ",
        credential_forwarding: "explicit_origin",
        credential_source_origin: "https://identity.example.com/path",
        credential_target_origin: "https://balance.example.com/old-path",
        confirmed_at: "2026-08-20T03:04:05+08:00",
      },
    });

    expect(normalized).toEqual(expect.objectContaining({
      enabled: true,
      identity_origin: "https://identity.example.com",
      login_url: "https://login.example.com/sign-in",
      identity_mode: "standard",
    }));
    expect(normalized?.balance).toEqual(expect.objectContaining({
      mode: "api",
      method: "GET",
      target_url: "https://balance.example.com/api/balance",
      unit: "USD",
      credential_forwarding: "explicit_origin",
      credential_source_origin: "https://identity.example.com",
      credential_target_origin: "https://balance.example.com",
      confirmed_at: "2026-08-19T19:04:05.000Z",
    }));
    expect(normalized?.balance?.remaining).toEqual({
      kind: "json_path",
      path_or_selector: "data.wallet.remaining",
      number_format: "plain",
    });
  });

  it("invalidates credential confirmation when the saved target origin is stale", () => {
    const rule = normalizedBalanceRule({
      mode: "api",
      target_url: "https://new-target.example.com/api/balance",
      remaining: { kind: "json_path", path_or_selector: "balance" },
      credential_forwarding: "explicit_origin",
      credential_source_origin: "https://identity.example.com",
      credential_target_origin: "https://old-target.example.com",
      confirmed_at: "2026-08-20T00:00:00.000Z",
    });

    expect(rule.credential_forwarding).toBe("none");
    expect(rule.credential_source_origin).toBeUndefined();
    expect(rule.credential_target_origin).toBeUndefined();
    expect(rule.confirmed_at).toBeUndefined();
  });

  it("treats disabled rules as absent and rejects incomplete enabled rules", () => {
    expect(normalizeSiteCustomCompatibility({ enabled: false, cookie: "secret" })).toBeUndefined();
    expect(() => normalizeSiteCustomCompatibility({
      enabled: true,
      identity_mode: "user_confirmed",
      balance: {
        mode: "api",
        target_url: "https://balance.example.com/api",
        remaining: { kind: "json_path", path_or_selector: "balance" },
      },
    })).toThrow("用户确认身份模式必须配置浏览器登录 URL");
    expect(() => normalizedBalanceRule({
      mode: "page",
      target_url: "javascript:alert(1)",
      remaining: { kind: "css_selector", path_or_selector: ".balance" },
    })).toThrow("http:// 或 https://");
  });

  it("reads safe dot and bracket JSON paths without expression evaluation", () => {
    const payload = {
      data: {
        wallets: [{ "remain-value": 12.5 }],
      },
    };

    expect(parseCustomJsonPath("$.data.wallets[0]['remain-value']")).toEqual([
      "data",
      "wallets",
      0,
      "remain-value",
    ]);
    expect(readCustomJsonPath(payload, "data.wallets[0][\"remain-value\"]")).toEqual({
      ok: true,
      found: true,
      value: 12.5,
    });
    expect(readCustomJsonPath(payload, "data.wallets[*]")).toEqual({
      ok: false,
      error: "JSON 字段路径括号只支持数组索引或引号字段名",
    });
    expect(readCustomJsonPath(payload, "$data.wallets")).toEqual({
      ok: false,
      error: "JSON 字段路径的 $ 后必须是点号或括号",
    });
  });

  it("maps JSON values to the existing balance item shape", () => {
    const rule = normalizedBalanceRule({
      mode: "api",
      target_url: "https://balance.example.com/api/balance",
      success_path: "ok",
      total: {
        kind: "json_path",
        path_or_selector: "data.total",
        regex: "([0-9,.]+)",
        number_format: "comma",
      },
      used: {
        kind: "json_path",
        path_or_selector: "data.used",
      },
      unit: "$",
    });

    expect(mapCustomBalanceItem({
      kind: "json",
      value: { ok: true, data: { total: "$1,234.50 USD", used: 34.5 } },
    }, rule)).toEqual({
      ok: true,
      item: {
        label: "$",
        remaining: 1_200,
        total: 1_234.5,
        used: 34.5,
        unit: "$",
      },
    });
  });

  it("extracts balance text and attributes with CSS selectors", () => {
    const document = domRoot({
      ".remaining": { textContent: "余额 1.234,56 EUR", tagName: "SPAN" },
      "#total": {
        tagName: "SPAN",
        attributes: { "data-value": "2,000.00" },
      },
    });
    const rule = normalizedBalanceRule({
      mode: "page",
      target_url: "https://portal.example.com/wallet",
      remaining: {
        kind: "css_selector",
        path_or_selector: ".remaining",
        regex: "([0-9.,]+)",
        number_format: "decimal",
      },
      total: {
        kind: "css_selector",
        path_or_selector: "#total",
        attribute: "data-value",
        number_format: "comma",
      },
      unit: "EUR",
    });

    expect(mapCustomBalanceItem({ kind: "dom", root: document }, rule)).toEqual({
      ok: true,
      item: {
        label: "EUR",
        remaining: 1_234.56,
        total: 2_000,
        used: 765.44,
        unit: "EUR",
      },
    });
  });

  it("refuses to read sensitive input values", () => {
    const document = domRoot({
      "#api-token": {
        tagName: "INPUT",
        attributes: { id: "api-token", value: "secret-value" },
      },
    });

    expect(extractCustomValue({ kind: "dom", root: document }, {
      kind: "css_selector",
      path_or_selector: "#api-token",
      attribute: "value",
    })).toEqual({
      ok: false,
      error: "规则不能读取密码、令牌或其他敏感输入元素",
    });
  });

  it("classifies already-checked, success, challenge, and auth failures", () => {
    const rule = normalizedCheckinRule({
      mode: "api",
      target_url: "https://checkin.example.com/api/check-in",
      method: "POST",
      success: { kind: "json_path", path_or_selector: "data.success" },
      already_checked: { kind: "json_path", path_or_selector: "data.already" },
    });

    expect(classifyCustomCheckinResult(rule, {
      kind: "json",
      value: { data: { success: true, already: true } },
    }).status).toBe("already_checked");
    expect(classifyCustomCheckinResult(rule, {
      kind: "json",
      value: { data: { success: true, already: false } },
    }).status).toBe("success");
    expect(classifyCustomCheckinResult(rule, {
      kind: "json",
      value: { data: { success: false, already: false } },
    }, { bodyText: "Cloudflare Turnstile challenge" }).status).toBe("manual_required");
    expect(classifyCustomCheckinResult(rule, {
      kind: "json",
      value: { data: { success: false, already: false } },
    }, { httpStatus: 401 }).status).toBe("login_required");
    expect(classifyCustomCheckinResult(rule, {
      kind: "json",
      value: { data: { success: "", already: false } },
    }).status).toBe("failed");

    const pageRule = normalizedCheckinRule({
      mode: "page",
      target_url: "https://checkin.example.com/daily",
      action_selector: "#check-in",
      success: { kind: "css_selector", path_or_selector: "#checked-icon" },
    });
    expect(classifyCustomCheckinResult(pageRule, {
      kind: "dom",
      root: domRoot({ "#checked-icon": { tagName: "SPAN" } }),
    }).status).toBe("success");
  });

  it("authorizes forwarding only for the confirmed exact source and target origins", () => {
    const rule = normalizedCheckinRule({
      mode: "api",
      target_url: "https://checkin.example.com/api/check-in",
      success: { kind: "json_path", path_or_selector: "success" },
      credential_forwarding: "explicit_origin",
      credential_source_origin: "https://identity.example.com",
      credential_target_origin: "https://checkin.example.com",
      confirmed_at: "2026-08-20T00:00:00.000Z",
    });

    expect(isCustomCredentialForwardingAuthorized(
      rule,
      "https://identity.example.com/account",
      "https://checkin.example.com/another-path",
    )).toBe(true);
    expect(isCustomCredentialForwardingAuthorized(
      rule,
      "https://other.example.com",
      "https://checkin.example.com/another-path",
    )).toBe(false);
    expect(isCustomCredentialForwardingAuthorized(
      rule,
      "https://identity.example.com",
      "https://redirect.example.com",
    )).toBe(false);
  });
});
