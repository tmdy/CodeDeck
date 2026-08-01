// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ParameterSettingsPanel } from "../../../components/settings/ParameterSettingsPanel.jsx";
import { defaultParameterSettings } from "../../parameter/types.js";
import type { Profile } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

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
    expect(html).toContain("间隔模式");
    expect(html).toContain("固定间隔");
    expect(html).toContain("随机间隔");
    expect(html).toContain("自动继续关键词（英文逗号分隔）");
    expect(html).not.toContain("<textarea");
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

  it("renders the local delegation switch and Profile blacklist", () => {
    const profiles: Profile[] = [{
      provider: "codex",
      name: "Delegated",
      url: "https://example.com/v1",
      key: "secret",
      selectedModelId: "gpt-test",
    }];
    const html = renderToStaticMarkup(
      <ParameterSettingsPanel
        settings={{
          ...defaultParameterSettings(),
          agent_bridge: {
            enabled: true,
            max_concurrent_tasks: 4,
            blocked_profile_keys: ["codex::Delegated"],
          },
        }}
        profiles={profiles}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain("本地 AI 委托接口");
    expect(html).toContain("允许本机 AI 调用 Profile");
    expect(html).toContain("Profile 黑名单");
    expect(html).toContain("灰色表示禁止调用");
    expect(html).toContain("Delegated");
    expect(html).toContain("codex");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("secret");
    expect(html).not.toContain("https://example.com");
  });

  it("adds a Profile to the blacklist when its option is clicked", async () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ParameterSettingsPanel
          settings={defaultParameterSettings()}
          profiles={[{
            provider: "codex",
            name: "Delegated",
            url: "https://example.com/v1",
            key: "secret",
            selectedModelId: "gpt-test",
          }]}
          onChange={onChange}
        />,
      );
    });

    const option = container.querySelector<HTMLButtonElement>(
      ".parameter-profile-blacklist-option",
    );
    expect(option?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => option?.click());

    expect(onChange).toHaveBeenCalledWith({
      agent_bridge: expect.objectContaining({
        blocked_profile_keys: ["codex::Delegated"],
      }),
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("parses the single-line keyword field with comma compatibility and deduplication", async () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ParameterSettingsPanel
          settings={defaultParameterSettings()}
          onChange={onChange}
        />,
      );
    });

    const keywordInput = container.querySelector<HTMLInputElement>(
      'input[placeholder^="high demand"]',
    );
    expect(keywordInput).not.toBeNull();
    await act(async () => {
      setInputValue(keywordInput!, "high demand, rate limit，high demand, temporary errors");
    });

    expect(onChange).toHaveBeenLastCalledWith({
      terminal: expect.objectContaining({
        auto_continue_keywords: ["high demand", "rate limit", "temporary errors"],
      }),
    });

    await act(async () => root.unmount());
    container.remove();
  });
});
