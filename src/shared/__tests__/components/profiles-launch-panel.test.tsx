import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesLaunchPanel } from "../../../components/profiles/ProfilesLaunchPanel.jsx";

describe("ProfilesLaunchPanel", () => {
  it("renders launch controls before session picker and command preview without model mapping", () => {
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
        }}
        disabled={false}
        resumeDisabled={false}
        sessions={[
          {
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
      />,
    );

    expect(html.indexOf("直接启动")).toBeLessThan(html.indexOf("恢复会话"));
    expect(html.indexOf("恢复会话")).toBeLessThan(html.indexOf("命令预览"));
    expect(html).toContain('codex resume &quot;session-1&quot;');
    expect(html).toContain("C:/repo");
    expect(html).toContain("CODEX_SITE_API_KEY");
    expect(html).toContain("[已设置]");
    expect(html).not.toContain("模型映射");
  });
});
