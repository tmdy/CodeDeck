import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BalanceTestButton } from "../../../components/balance/BalanceTestButton.jsx";

describe("BalanceTestButton", () => {
  it("renders the session hint alongside balance metadata", () => {
    const html = renderToStaticMarkup(
      <BalanceTestButton
        state={{
          provider: "codex",
          profile_name: "Relay",
          base_url: "https://new-api.example.com",
          running: false,
          supported: true,
          success: false,
          message: "同站点存在多套后台会话，请先选择要使用的会话",
          items: [],
          endpoint: "https://new-api.example.com/api/user/self",
          finished_at_display: "2026/05/05 12:00:00",
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
});
