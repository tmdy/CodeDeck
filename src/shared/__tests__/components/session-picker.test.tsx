// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionPicker } from "../../../components/launcher/SessionPicker.jsx";
import type { SessionSummary } from "../../services/session-service.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const longSession: SessionSummary = {
  provider: "claude",
  session_id: "session-long",
  cwd: "C:/Users/99395/Downloads/新建 文本文档/一个非常长的项目目录/继续嵌套/直到足以撑开原生下拉框",
  updated_at: "2026-05-04T10:00:00.000Z",
  preview: "可以再加一句更适合 Claude Code 的执行指令，并且这是一段非常长的会话预览文本",
};

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

  it("renders loading state instead of empty state while sessions are loading", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[]}
        selectedId=""
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
      />,
    );

    expect(html).toContain("正在加载会话...");
    expect(html).not.toContain("当前工作目录未找到会话。");
  });

  it("renders an inline session list instead of native options", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[longSession]}
        selectedId=""
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("请选择最近会话");
    expect(html).toContain("role=\"listbox\"");
    expect(html).not.toContain("<option");
    expect(html).not.toContain("<select");
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

  it("shows a bounded inline list and preserves long session text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SessionPicker
          sessions={[longSession]}
          selectedId=""
          onSelect={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });

    const listbox = container.querySelector('[role="listbox"][aria-label="最近会话列表"]');
    expect(listbox).toBeInstanceOf(HTMLElement);
    expect(listbox?.textContent).toContain(longSession.preview);
    expect(listbox?.textContent).toContain(longSession.cwd);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("selects a session from the inline list", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        <SessionPicker
          sessions={[longSession]}
          selectedId=""
          onSelect={onSelect}
          onRefresh={vi.fn()}
        />,
      );
    });

    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    await act(async () => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith("session-long");
    expect(container.querySelector('[role="listbox"]')).toBeInstanceOf(HTMLElement);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("disables session selection while keeping the list visible", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        <SessionPicker
          sessions={[longSession]}
          selectedId=""
          onSelect={onSelect}
          onRefresh={vi.fn()}
          disabled
        />,
      );
    });

    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    await act(async () => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeInstanceOf(HTMLElement);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
