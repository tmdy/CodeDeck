// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BalanceTestButton } from "../../../components/balance/BalanceTestButton.jsx";
import type { BalanceCheckState } from "../../balance/types.js";

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
  it("renders the session hint alongside balance metadata", () => {
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
    expect(html).toContain("未选择后台会话");
    expect(html).toContain("https://new-api.example.com/api/user/self");
    expect(html).toContain("2026/05/05 12:00:00");
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
});
