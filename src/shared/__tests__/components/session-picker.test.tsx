// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("renders an unloaded placeholder before the first session fetch", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[]}
        selectedId=""
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        isUninitialized
      />,
    );

    expect(html).toContain("恢复会话");
    expect(html).toContain("尚未加载当前工作目录的会话。");
    expect(html).toContain("点击");
    expect(html).toContain("加载会话");
    expect(html).toContain("未选择会话");
  });

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
    expect(html).toContain("刷新");
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

  it("renders selected session user prompts when available", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[
          {
            provider: "claude",
            session_id: "session-prompts",
            cwd: "C:/repo",
            updated_at: "2026-05-04T10:00:00.000Z",
            preview: "相同开头提示词",
            user_prompts: [
              "相同开头提示词，第一种任务分支",
              "请继续分析这个分支的错误",
            ],
          },
        ]}
        selectedId="session-prompts"
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("开头问答");
    expect(html).toContain("问");
    expect(html).toContain("相同开头提示词，第一种任务分支");
    expect(html).toContain("请继续分析这个分支的错误");
  });

  it("renders selected session conversation excerpts as a unified question-answer list", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[
          {
            provider: "claude",
            session_id: "session-excerpts",
            cwd: "C:/repo",
            updated_at: "2026-05-04T10:00:00.000Z",
            preview: "相同开头提示词",
            user_prompts: ["旧字段提问"],
            conversation_excerpts: [
              { role: "user", text: "先看历史记录展示问题" },
              { role: "assistant", text: "我会检查 SessionPicker 和 session-service。" },
            ],
          },
        ]}
        selectedId="session-excerpts"
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("开头问答");
    expect(html).toContain("问");
    expect(html).toContain("答");
    expect(html).toContain("先看历史记录展示问题");
    expect(html).toContain("我会检查 SessionPicker 和 session-service。");
    expect(html).not.toContain("旧字段提问");
  });

  it("lets selected session details expand into the main page scroll", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const longImagePrompt = `<image name=[Image #1] path="C:\\Users\\99395\\AppData\\Local\\Temp\\codex-clipboard-xZdCCg.png">`;

    await act(async () => {
      root.render(
        <SessionPicker
          sessions={[
            {
              provider: "codex",
              session_id: "session-image-prompt",
              cwd: "C:/Users/99395/Sync/软件开发项目/skills管理/一个很长的目录/继续嵌套/直到足够长",
              updated_at: "2026-06-09T10:00:00.000Z",
              preview: longImagePrompt,
              conversation_excerpts: [
                { role: "user", text: longImagePrompt },
                { role: "assistant", text: "我会先按本轮适用的技能说明看一下流程约束，再定位渲染边界。" },
                { role: "assistant", text: "使用系统化调试，因为这是界面布局问题，需要先确认触发条件。" },
                { role: "user", text: "好像是因为图片输入长度导致的" },
              ],
            },
          ]}
          selectedId="session-image-prompt"
          onSelect={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });

    expect(container.querySelector(".session-picker.has-selection")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector(".session-picker-selected-summary")).toBeInstanceOf(HTMLElement);

    const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
    const selectedSummaryRule = css.match(/\.session-picker-selected-summary\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const selectedListRule = css.match(/\.session-picker\.has-selection\s+\.session-picker-list\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    expect(css).toMatch(/\.session-picker\.has-selection\s+\.session-picker-list\s*\{[^}]*max-height:/s);
    expect(selectedListRule).toMatch(/max-height:\s*min\(320px,\s*42vh\)/);
    expect(selectedSummaryRule).not.toMatch(/max-height:/);
    expect(selectedSummaryRule).not.toMatch(/overflow-y:\s*auto/);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not render the selected session prompts block when prompts are unavailable", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[longSession]}
        selectedId="session-long"
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).not.toContain("开头提问");
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
