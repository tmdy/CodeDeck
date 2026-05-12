// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SiteBalanceSessionPanel } from "../../../components/profiles/SiteBalanceSessionPanel.jsx";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSiteSession(id: string, label: string): SiteBalanceSession {
  return {
    id,
    label,
    base_url: "https://new-api.example.com",
    access_token: `token-${id}`,
    user_id: "42",
    updated_at: "2026-05-05T09:00:00.000Z",
  };
}

describe("SiteBalanceSessionPanel", () => {
  it("uses api-key auto mode without recommending a session when no sessions exist", () => {
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain("站点后台会话");
    expect(html).toContain(">API Key 自动<");
    expect(html).not.toContain("当前站点还没有后台会话");
    expect(html).not.toContain("选择“新建会话”后填写 Access Token / Session 和 User ID");
    expect(html).toContain(">新建会话<");
  });

  it("renders editable fields and save action when creating a new session", () => {
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[]}
        balanceSessionSelection="new"
        balanceSessionDraft={{ label: "", access_token: "token-a", user_id: "42" }}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onSaveBalanceSession={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain("Access Token / Session");
    expect(html).toContain("User ID");
    expect(html).toContain("保存会话");
    expect(html).not.toContain("删除当前会话");
  });

  it("renders existing session options and delete action when editing an existing session", () => {
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[makeSiteSession("sess-a", "账号1")]}
        balanceSessionSelection="sess-a"
        balanceSessionDraft={{ label: "账号1", access_token: "token-a", user_id: "42" }}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onSaveBalanceSession={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain(">API Key 自动<");
    expect(html).toContain("账号1");
    expect(html).toContain("新建会话");
    expect(html).toContain("保存会话");
    expect(html).toContain("删除当前会话");
    expect(html).not.toContain("备注名");
  });

  it("invokes save and delete actions from the compact action row", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSaveBalanceSession = vi.fn();
    const onDeleteSiteBalanceSession = vi.fn();

    await act(async () => {
      root.render(
        <SiteBalanceSessionPanel
          siteBalanceSessions={[makeSiteSession("sess-a", "账号1")]}
          balanceSessionSelection="sess-a"
          balanceSessionDraft={{ label: "账号1", access_token: "token-a", user_id: "42" }}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onSaveBalanceSession={onSaveBalanceSession}
          onDeleteSiteBalanceSession={onDeleteSiteBalanceSession}
        />,
      );
    });

    const actionRow = container.querySelector(".balance-session-actions");
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存会话",
    );
    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "删除当前会话",
    );

    expect(actionRow).toBeInstanceOf(HTMLDivElement);
    expect(saveButton?.parentElement).toBe(actionRow);
    expect(deleteButton?.parentElement).toBe(actionRow);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveBalanceSession).toHaveBeenCalledTimes(1);
    expect(onDeleteSiteBalanceSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
