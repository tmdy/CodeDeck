import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionPicker } from "../../../components/launcher/SessionPicker.jsx";

describe("SessionPicker", () => {
  it("renders empty state when there are no sessions", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[]}
        selectedId=""
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("恢复会话");
    expect(html).toContain("当前工作目录未找到会话。");
    expect(html).toContain("未选择会话");
  });

  it("renders session options when sessions are available", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[
          {
            provider: "claude",
            session_id: "session-1",
            cwd: "C:/repo",
            updated_at: "2026-05-04T10:00:00.000Z",
            preview: "修复 Profiles 布局",
          },
        ]}
        selectedId=""
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("修复 Profiles 布局");
    expect(html).toContain("C:/repo");
    expect(html).toContain("请选择最近会话");
  });

  it("renders selected session summary", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[
          {
            provider: "claude",
            session_id: "session-1",
            cwd: "C:/repo",
            updated_at: "2026-05-04T10:00:00.000Z",
            preview: "修复 Profiles 布局",
          },
          {
            provider: "claude",
            session_id: "session-2",
            cwd: "C:/repo-2",
            updated_at: "2026-05-04T11:00:00.000Z",
            preview: "测试会话加载",
          },
        ]}
        selectedId="session-2"
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("当前选中");
    expect(html).toContain("测试会话加载");
    expect(html).toContain("session-2");
  });
});
