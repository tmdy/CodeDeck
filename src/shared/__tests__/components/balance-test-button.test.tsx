// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BalanceTestButton } from "../../../components/balance/BalanceTestButton.jsx";
import type { BalanceCheckState } from "../../balance/types.js";
import { localDateKey } from "../../checkin/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeFailedState(): BalanceCheckState {
  return {
    provider: "codex",
    profile_name: "Relay",
    base_url: "https://new-api.example.com",
    running: false,
    supported: true,
    success: false,
    message: "余额接口鉴权失败，请检查 API Key",
    items: [],
    endpoint: "https://new-api.example.com/api/user/self",
    finished_at_display: "2026/05/05 12:00:00",
  };
}

describe("BalanceTestButton", () => {
  it("keeps balance metadata out of the balance action area", () => {
    const html = renderToStaticMarkup(
      <BalanceTestButton
        state={{
          ...makeFailedState(),
          message: "同站点存在多套后台会话，请先选择要使用的会话",
        }}
        sessionHint="未选择后台会话"
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain("检测余额");
    expect(html).not.toContain("未选择后台会话");
    expect(html).not.toContain("https://new-api.example.com/api/user/self");
    expect(html).not.toContain("2026/05/05 12:00:00");
  });

  it("renders a clear action for failed balance checks", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClear = vi.fn();

    await act(async () => {
      root.render(
        <BalanceTestButton
          state={makeFailedState()}
          onTest={vi.fn()}
          onClear={onClear}
        />,
      );
    });

    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "清除结果",
    );
    expect(clearButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClear).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders account-scoped check-in controls and manual verification guidance", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCheckin = vi.fn();
    const onToggle = vi.fn();
    const onOpenManual = vi.fn();

    await act(async () => {
      root.render(
        <BalanceTestButton
          state={null}
          onTest={vi.fn()}
          checkinAvailable
          autoCheckinEnabled
          enabledAccountCount={2}
          onCheckin={onCheckin}
          onRunEnabledCheckins={vi.fn()}
          onToggleAutoCheckin={onToggle}
          onOpenManualCheckin={onOpenManual}
          checkinState={{
            status: "manual_required",
            trigger: "automatic",
            message: "站点需要 Cloudflare / Turnstile 人工验证",
            manual_url: "https://new-api.example.com/console/personal",
            diagnostic_run_id: "abcdef123456",
            last_attempt_at: "2026-07-14T09:00:00.000Z",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("立即签到");
    expect(container.textContent).toContain("签到已启用账号 (2)");
    expect(container.textContent).toContain("需要人工验证");
    expect(container.textContent).toContain("诊断编号：abcdef123456");
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "立即签到",
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "重新打开验证窗口",
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onCheckin).toHaveBeenCalledTimes(1);
    expect(onOpenManual).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    container.remove();
  });

  it("disables duplicate actions while waiting for human verification", () => {
    const html = renderToStaticMarkup(
      <BalanceTestButton
        state={null}
        onTest={vi.fn()}
        checkinAvailable
        enabledAccountCount={1}
        onCheckin={vi.fn()}
        onRunEnabledCheckins={vi.fn()}
        onToggleAutoCheckin={vi.fn()}
        checkinState={{
          status: "verifying",
          trigger: "automatic",
          message: "等待人工验证",
        }}
      />,
    );

    expect(html).toContain("验证中…");
    expect(html).toContain("等待人工验证");
    expect(html).toContain("签到已启用账号 (1)");
    expect(html).not.toContain("批量签到中...");
    expect(html).not.toContain("重新打开验证窗口");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("disables today's check-in, removes duplicate balance details, and simplifies auto check-in", () => {
    const html = renderToStaticMarkup(
      <BalanceTestButton
        state={{
          provider: "codex",
          profile_name: "Relay",
          base_url: "https://new-api.example.com",
          running: false,
          supported: true,
          success: true,
          message: "余额已更新",
          items: [{
            label: "USD",
            remaining: 112.17,
            total: 142.01,
            used: 29.84,
            unit: "$",
          }],
          finished_at_display: "",
        }}
        onTest={vi.fn()}
        checkinAvailable
        enabledAccountCount={0}
        onCheckin={vi.fn()}
        onRunEnabledCheckins={vi.fn()}
        onToggleAutoCheckin={vi.fn()}
        checkinState={{
          status: "success",
          trigger: "manual",
          message: "人工验证并签到完成",
          reward: "614271",
          satisfied_local_date: localDateKey(),
          last_attempt_at: new Date().toISOString(),
        }}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>今日已签到<\/button>/);
    expect(html).toContain("签到已启用账号 (0)");
    expect(html).toContain("请先勾选至少一个账号的自动签到");
    expect(html).toContain("$112.17 剩余");
    expect(html).toContain("奖励：$1.23");
    expect(html).not.toContain("奖励：614271");
    expect(html).not.toContain("USD: 剩余");
    expect(html).toContain("自动签到");
    expect(html).not.toContain("每天启动后随机");
    expect(html).not.toContain("下次自动签到");
    expect(html.lastIndexOf("自动签到")).toBeGreaterThan(html.indexOf("人工验证并签到完成"));
  });
});
