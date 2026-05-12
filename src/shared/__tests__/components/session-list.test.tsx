import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionList } from "../../../components/launcher/SessionList.jsx";

function createSession(index: number) {
  return {
    provider: "codex" as const,
    session_id: `session-${index}`,
    cwd: `C:/repo-${index}`,
    updated_at: `2026-05-05T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    preview: `会话 ${index}`,
  };
}

describe("SessionList", () => {
  it("renders the history scope toolbar, selected session details and restore profile selector", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="claude"
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
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).not.toContain("当前项目");
    expect(html).not.toContain("本机最近");
    expect(html).toContain("session-1");
    expect(html).toContain("跨项目最近会话");
    expect(html).toContain("用于恢复的 Profile");
    expect(html).toContain("恢复选中会话");
    expect(html).toContain("Official");
    expect(html).toContain("claude --resume");
  });

  it("renders Codex session source in selected session details", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        sessions={[
          {
            provider: "codex",
            session_id: "global-session",
            cwd: "C:/repo-global",
            updated_at: "2026-05-05T07:00:00.000Z",
            preview: "全局历史会话",
            source_kind: "global_codex",
            source_home: "C:/Users/99395/.codex",
          },
        ]}
        selectedId="global-session"
        restoreProfiles={[{ key: "codex::Official", label: "Official", cwd: "C:/repo-global" }]}
        selectedRestoreProfileKey="codex::Official"
        restoreDisabled={false}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("来源");
    expect(html).toContain("全局 .codex");
    expect(html).toContain("C:/Users/99395/.codex");
  });

  it("shows an explicit provider-missing hint when there is no available restore profile", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
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
        sessions={sessions}
        selectedId="claude-session"
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
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

  it("renders only the first 20 sessions by default and shows a load-more summary", () => {
    const sessions = Array.from({ length: 20 }, (_, index) => createSession(index + 1));

    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        sessions={sessions}
        hasMoreSessions
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("会话 1");
    expect(html).toContain("会话 20");
    expect(html).not.toContain("会话 21");
    expect(html).toContain("已显示 20");
    expect(html).toContain("加载更多 20 条");
  });

  it("shows a loading message instead of an empty state while sessions are loading", () => {
    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        sessions={[]}
        isLoading
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("正在加载会话");
    expect(html).not.toContain("暂无会话记录");
  });

  it("keeps the selected session visible when it is outside the default visible range", () => {
    const sessions = Array.from({ length: 25 }, (_, index) => createSession(index + 1));

    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        sessions={sessions}
        selectedId="session-25"
        restoreProfiles={[]}
        selectedRestoreProfileKey=""
        restoreDisabled
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("会话 20");
    expect(html).not.toContain("会话 21");
    expect(html).toContain("会话 25");
    expect(html).toContain("<code>session-25</code>");
  });
});
