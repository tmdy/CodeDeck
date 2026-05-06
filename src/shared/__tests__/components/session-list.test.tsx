import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionList } from "../../../components/launcher/SessionList.jsx";

describe("SessionList", () => {
  it("renders the history scope toolbar, selected session details and restore profile selector", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="claude"
        scope="global_recent"
        sessions={[
          {
            provider: "claude",
            session_id: "session-1",
            cwd: "C:/repo-a",
            updated_at: "2026-05-05T07:00:00.000Z",
            preview: "跨项目最近会话",
          },
        ]}
        selectedId="session-1"
        restoreProfiles={[
          { key: "claude::Official", label: "Official", cwd: "C:/repo-a" },
          { key: "claude::Backup", label: "Backup", cwd: "C:/repo-b" },
        ]}
        selectedRestoreProfileKey="claude::Official"
        restoreHint="恢复时将使用所选 Profile 当前保存的工作目录。"
        preview={{
          command: 'claude --resume "session-1"',
          cwd: "C:/repo-a",
          env: [],
          valid: true,
        }}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onScopeChange={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("当前项目");
    expect(html).toContain("本机最近");
    expect(html).toContain("session-1");
    expect(html).toContain("跨项目最近会话");
    expect(html).toContain("用于恢复的 Profile");
    expect(html).toContain("恢复选中会话");
    expect(html).toContain("Official");
    expect(html).toContain("claude --resume");
  });

  it("shows an explicit provider-missing hint when there is no available restore profile", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        scope="global_recent"
        sessions={[
          {
            provider: "codex",
            session_id: "session-2",
            cwd: "C:/repo-b",
            updated_at: "2026-05-05T08:00:00.000Z",
            preview: "Codex 历史",
          },
        ]}
        selectedId="session-2"
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreHint="当前 provider 尚未配置可用 profile，无法恢复该会话。"
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onScopeChange={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("当前 provider 尚未配置可用 profile，无法恢复该会话。");
    expect(html).toContain("恢复选中会话");
    expect(html).toContain("disabled");
  });

  it("does not render a mismatched provider session after parent-side filtering", () => {
    const sessions = [
      {
        provider: "claude" as const,
        session_id: "claude-session",
        cwd: "C:/repo-a",
        updated_at: "2026-05-05T07:00:00.000Z",
        preview: "Claude 历史",
      },
      {
        provider: "codex" as const,
        session_id: "codex-session",
        cwd: "C:/repo-b",
        updated_at: "2026-05-05T08:00:00.000Z",
        preview: "Body Data Sync",
      },
    ].filter((session) => session.provider === "claude");

    const html = renderToStaticMarkup(
      <SessionList
        provider="claude"
        scope="global_recent"
        sessions={sessions}
        selectedId="claude-session"
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onScopeChange={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("当前 Provider：claude");
    expect(html).toContain("Claude 历史");
    expect(html).toContain("<code>claude</code>");
    expect(html).not.toContain("Body Data Sync");
    expect(html).not.toContain("<code>codex</code>");
  });
});
