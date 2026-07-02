import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesLaunchPanel } from "../../../components/profiles/ProfilesLaunchPanel.jsx";

describe("ProfilesLaunchPanel", () => {
  it("renders launch controls before session picker without command preview or model mapping", () => {
    const html = renderToStaticMarkup(
      <ProfilesLaunchPanel
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
  });
});
