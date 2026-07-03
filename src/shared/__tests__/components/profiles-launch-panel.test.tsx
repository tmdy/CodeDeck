// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CmdPreview } from "../../../components/launcher/CommandPreview.jsx";
import { ProfilesLaunchPanel } from "../../../components/profiles/ProfilesLaunchPanel.jsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfilesLaunchPanel", () => {
  it("does not imply global capabilities are enabled when the command preview summary is missing", () => {
    const html = renderToStaticMarkup(
      <CmdPreview
        preview={{
          command: "codex --profile site-test",
          cwd: "C:/repo",
          env: [],
          valid: true,
        }}
      />,
    );

    expect(html).toContain("全局能力");
    expect(html).toContain("(未设置)");
    expect(html).not.toContain("继承全局 MCP/Skills：启动时启用");
  });

  it("renders launch controls before session picker without command preview or model mapping", () => {
    const html = renderToStaticMarkup(
      <ProfilesLaunchPanel
        provider="codex"
        preview={{
          command: 'codex resume "session-1"',
          cwd: "C:/repo",
          env: [
            { name: "CODEX_HOME", present: true, displayValue: "C:/codex-home", sensitive: false },
            { name: "CODEX_SITE_API_KEY", present: true, displayValue: "[已设置]", sensitive: true },
          ],
          valid: true,
          permissionSummary: "Codex: workspace-write + on-request",
          capabilitySummary: "继承全局 MCP/Skills：启动时启用",
        }}
        disabled={false}
        resumeDisabled={false}
        sessions={[
          {
            provider: "codex",
            session_id: "session-1",
            cwd: "C:/repo",
            updated_at: "2026-05-04T10:00:00.000Z",
            preview: "继续当前工作",
          },
        ]}
        selectedSessionId="session-1"
        onSelectSession={vi.fn()}
        onRefreshSessions={vi.fn()}
        onDirectLaunch={vi.fn()}
        onContinueLaunch={vi.fn()}
        onResumeLaunch={vi.fn()}
        onTemporaryReadonlyLaunch={vi.fn()}
        onTemporaryFullAccessLaunch={vi.fn()}
      />,
    );

    expect(html.indexOf("直接启动")).toBeLessThan(html.indexOf("恢复会话"));
    expect(html).not.toContain("命令预览");
    expect(html).not.toContain('codex resume &quot;session-1&quot;');
    expect(html).not.toContain("CODEX_SITE_API_KEY");
    expect(html).toContain("将以以下权限启动");
    expect(html).toContain("Codex: workspace-write + on-request");
    expect(html).toContain("临时只读");
    expect(html).toContain("临时全权限");
    expect(html).not.toContain("模型映射");
  });

  it("uses compact launch controls to leave more room for session history", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
    expect(css).toMatch(
      /\.profiles-launch-panel\s+\.launch-controls\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(/\.profiles-launch-panel\s+\.launch-btn\.primary\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
    expect(css).toMatch(/\.profiles-launch-panel\s+\.launch-btn\s*\{[^}]*padding:\s*0\.38rem\s+0\.58rem/s);
    expect(css).toMatch(/\.profiles-launch-panel\s+\.launch-monitor-toggle\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  });

  it("shows a monitor toggle for Codex launches and notifies changes", () => {
    const onMonitorModeChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ProfilesLaunchPanel
          preview={{
            command: "codex --profile site-test",
            cwd: "C:/repo",
            env: [],
            valid: true,
          }}
          provider="codex"
          monitorModeEnabled={true}
          onMonitorModeChange={onMonitorModeChange}
          disabled={false}
          resumeDisabled={false}
          sessions={[]}
          selectedSessionId=""
          onSelectSession={vi.fn()}
          onRefreshSessions={vi.fn()}
          onDirectLaunch={vi.fn()}
          onContinueLaunch={vi.fn()}
          onResumeLaunch={vi.fn()}
          onTemporaryReadonlyLaunch={vi.fn()}
          onTemporaryFullAccessLaunch={vi.fn()}
        />,
      );
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (!checkbox) {
      throw new Error("Expected monitor mode checkbox to render");
    }
    expect(checkbox.checked).toBe(true);
    act(() => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onMonitorModeChange).toHaveBeenCalledWith(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not show the monitor toggle for Claude launches", () => {
    const html = renderToStaticMarkup(
      <ProfilesLaunchPanel
        preview={{
          command: "claude --continue",
          cwd: "C:/repo",
          env: [],
          valid: true,
        }}
        provider="claude"
        monitorModeEnabled={false}
        onMonitorModeChange={vi.fn()}
        disabled={false}
        resumeDisabled={false}
        sessions={[]}
        selectedSessionId=""
        onSelectSession={vi.fn()}
        onRefreshSessions={vi.fn()}
        onDirectLaunch={vi.fn()}
        onContinueLaunch={vi.fn()}
        onResumeLaunch={vi.fn()}
        onTemporaryReadonlyLaunch={vi.fn()}
        onTemporaryFullAccessLaunch={vi.fn()}
      />,
    );

    expect(html).not.toContain("开启监控模式");
  });
});
