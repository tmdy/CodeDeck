// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionList } from "../../../components/launcher/SessionList.jsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createSession(index: number) {
  return {
    provider: "codex" as const,
    session_id: `session-${index}`,
    cwd: `C:/repo-${index}`,
    updated_at: `2026-05-05T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    preview: `会话 ${index}`,
  };
}

function cssRule(selector: string): string {
  const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

describe("SessionList", () => {
  it("shows background catalog progress and lazily loaded opening excerpts", () => {
    const selected = {
      ...createSession(1),
      conversation_excerpts: [
        { role: "user" as const, text: "先检查会话刷新为什么慢" },
        { role: "assistant" as const, text: "先看索引和文件扫描路径" },
      ],
    };
    const html = renderToStaticMarkup(
      <SessionList
        provider="codex"
        sessions={[selected]}
        selectedId={selected.session_id}
        catalogState="building"
        restoreProfiles={[]}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRestoreProfile={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("正在整理旧历史");
    expect(html).toContain("开头问答");
    expect(html).toContain("先检查会话刷新为什么慢");
    expect(html).toContain("先看索引和文件扫描路径");
  });

  it("lets the sessions page fill remaining height while keeping panes scrollable", () => {
    expect(cssRule(".sessions-layout")).toContain("min-height: calc(100vh - 116px)");
    expect(cssRule(".sessions-layout")).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(cssRule(".session-list")).toContain("min-height: 0");
    expect(cssRule(".session-list")).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(cssRule(".sessions-detail-layout")).toContain("min-height: 0");
    expect(cssRule(".sessions-detail-layout")).toContain("align-items: stretch");
    expect(cssRule(".session-list-body")).toContain("min-height: 0");
    expect(cssRule(".session-list-body")).toContain("height: 100%");
    expect(cssRule(".session-list-body")).not.toContain("max-height: 600px");
    expect(cssRule(".session-detail-panel")).toContain("min-height: 0");
    expect(cssRule(".session-detail-panel")).toContain("overflow: auto");
  });

  it("keeps favorite controls visually compact in the session list", () => {
    expect(cssRule(".session-item-row")).toContain("grid-template-columns: minmax(0, 1fr) 32px");
    expect(cssRule(".session-item-row")).toContain("align-items: center");

    const favoriteButtonRule = cssRule(".session-favorite-btn");
    expect(favoriteButtonRule).toContain("width: 32px");
    expect(favoriteButtonRule).toContain("height: 32px");
    expect(favoriteButtonRule).toContain("background: transparent");
    expect(favoriteButtonRule).not.toContain("background: rgba(248, 250, 252, 0.88)");

    expect(cssRule(".session-favorite-btn.active")).toContain("background: var(--app-warm-soft)");
    expect(cssRule(".session-favorite-btn.compact")).toContain("width: 28px");
    expect(cssRule(".session-favorite-btn.compact")).toContain("height: 28px");
  });

  it("replaces the refresh label with a disabled spinner while refreshing", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SessionList
          provider="codex"
          sessions={[createSession(1)]}
          isRefreshing
          restoreProfiles={[]}
          selectedRestoreProfileKey=""
          restoreDisabled
          onSelect={vi.fn()}
          onRefresh={vi.fn()}
          onSelectRestoreProfile={vi.fn()}
          onRestore={vi.fn()}
        />,
      );
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(".session-refresh-button");
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.getAttribute("aria-busy")).toBe("true");
    expect(refreshButton?.getAttribute("aria-label")).toBe("正在刷新会话");
    expect(refreshButton?.textContent).toBe("");
    expect(refreshButton?.querySelector(".session-refresh-spinner")).toBeInstanceOf(HTMLElement);
    expect(container.textContent).toContain("会话 1");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders favorite controls without selecting the row when toggled", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const onToggleFavorite = vi.fn();
    const FavoriteSessionList = SessionList as unknown as (props: Record<string, unknown>) => ReactElement;

    await act(async () => {
      root.render(
        <FavoriteSessionList
          provider="codex"
          sessions={[createSession(1)]}
          selectedId=""
          restoreProfiles={[]}
          selectedRestoreProfileKey=""
          restoreDisabled
          getSessionKey={(session: ReturnType<typeof createSession>) => (
            `codex|app_runtime||${session.session_id}`
          )}
          favoriteSessionKeys={new Set(["codex|app_runtime||session-1"])}
          onSelect={onSelect}
          onRefresh={vi.fn()}
          onSelectRestoreProfile={vi.fn()}
          onRestore={vi.fn()}
          onToggleFavorite={onToggleFavorite}
        />,
      );
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="取消收藏会话：会话 1"]',
    );
    expect(favoriteButton).toBeInstanceOf(HTMLButtonElement);
    expect(favoriteButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      favoriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ session_id: "session-1" }));
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

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
            source_home: "C:/Users/example/.codex",
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
    expect(html).toContain("C:/Users/example/.codex");
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
