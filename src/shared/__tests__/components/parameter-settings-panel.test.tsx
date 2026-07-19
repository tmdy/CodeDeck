// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ParameterSettingsPanel } from "../../../components/settings/ParameterSettingsPanel.jsx";
import { defaultParameterSettings } from "../../parameter/types.js";

describe("ParameterSettingsPanel", () => {
  it("should not render obsolete launch timeout, Claude permission mode, or terminal mode inputs", () => {
    const html = renderToStaticMarkup(
      <ParameterSettingsPanel
        settings={defaultParameterSettings()}
        onChange={vi.fn()}
      />,
    );

    expect(html).not.toContain("启动超时");
    expect(html).not.toContain("权限模式");
    expect(html).toContain("余额检测超时");
    expect(html).toContain("Setting Sources");
    expect(html).toContain("终端与监控设置");
    expect(html).toContain("自动继续间隔");
    expect(html).toContain("Wire API");
    expect(html).toContain("跳过 Git 仓库检查");
    expect(html).not.toContain("终端模式");
    expect(html).not.toContain("受监控独立窗口");
    expect(html).not.toContain("系统直连");
    expect(html.indexOf("终端与监控设置")).toBeLessThan(html.indexOf("Claude CLI 特定设置"));
    expect(html.indexOf("Claude CLI 特定设置")).toBeLessThan(html.indexOf("Codex CLI 特定设置"));

    const codexSection = html.slice(
      html.indexOf("Codex CLI 特定设置"),
      html.indexOf("环境变量注入"),
    );
    expect(codexSection).not.toContain("自动继续");
  });
});
