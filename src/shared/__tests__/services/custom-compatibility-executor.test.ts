import { describe, expect, it, vi } from "vitest";
import { CustomCompatibilityExecutor } from "../../services/custom-compatibility-executor.js";
import { normalizeSiteCustomCompatibility, type CustomDomRoot } from "../../services/custom-compatibility.js";

function rule(value: unknown, key: "balance" | "checkin") {
  const normalized = normalizeSiteCustomCompatibility({
    enabled: true,
    identity_mode: "standard",
    [key]: value,
  });
  const result = normalized?.[key];
  if (!result) throw new Error(`${key} rule missing`);
  return result;
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function domRoot(values: Record<string, string>): CustomDomRoot {
  return {
    querySelector(selector) {
      if (!(selector in values)) return null;
      return {
        tagName: "SPAN",
        textContent: values[selector],
        getAttribute: () => null,
      };
    },
  };
}

describe("CustomCompatibilityExecutor", () => {
  it("runs a configured GET JSON balance request", async () => {
    const fetch = vi.fn(async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return response({ data: { remaining: 12 } });
    });
    const result = await new CustomCompatibilityExecutor().queryBalance(
      { provider: "claude", name: "Demo", url: "https://profile.example.com" },
      rule({
        mode: "api",
        target_url: "https://api.example.com/balance",
        remaining: { kind: "json_path", path_or_selector: "data.remaining" },
      }, "balance"),
      500,
      { request: { fetch } },
    );
    expect(result.success).toBe(true);
    expect(result.items[0]?.remaining).toBe(12);
  });

  it("does not follow redirects or hide authentication failures", async () => {
    const executor = new CustomCompatibilityExecutor();
    const redirect = await executor.checkin(
      rule({
        mode: "api",
        target_url: "https://api.example.com/checkin",
        method: "POST",
        success: { kind: "json_path", path_or_selector: "ok" },
      }, "checkin"),
      500,
      { request: { fetch: vi.fn(async () => response({}, 302)) } },
    );
    expect(redirect.status).toBe("failed");

    const unauthorized = await executor.checkin(
      rule({
        mode: "api",
        target_url: "https://api.example.com/checkin",
        method: "POST",
        success: { kind: "json_path", path_or_selector: "ok" },
      }, "checkin"),
      500,
      { request: { fetch: vi.fn(async () => response({}, 401)) } },
    );
    expect(unauthorized.status).toBe("login_required");
  });

  it("runs page balance extraction and classifies page check-in success", async () => {
    const executor = new CustomCompatibilityExecutor();
    const page = {
      readBalance: vi.fn(async () => domRoot({ ".remaining": "7" })),
      runCheckin: vi.fn(async () => ({
        root: domRoot({ "#done": "完成" }),
        challengeDetected: false,
      })),
    };
    const balance = await executor.queryBalance(
      { provider: "codex", name: "Portal", url: "https://profile.example.com" },
      rule({
        mode: "page",
        target_url: "https://portal.example.com/wallet",
        page_url: "https://portal.example.com/wallet",
        remaining: { kind: "css_selector", path_or_selector: ".remaining" },
      }, "balance"),
      500,
      { request: { fetch: vi.fn() }, page },
    );
    expect(balance.success).toBe(true);
    expect(page.readBalance).toHaveBeenCalled();

    const checkin = await executor.checkin(
      rule({
        mode: "page",
        target_url: "https://portal.example.com/checkin",
        page_url: "https://portal.example.com/checkin",
        action_selector: "#checkin",
        success: { kind: "css_selector", path_or_selector: "#done" },
      }, "checkin"),
      500,
      { request: { fetch: vi.fn() }, page },
    );
    expect(checkin.status).toBe("success");
  });
});
