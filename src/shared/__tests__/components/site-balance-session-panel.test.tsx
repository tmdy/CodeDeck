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

  it("renders browser login by default and keeps PAT under advanced compatibility", () => {
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[]}
        balanceSessionSelection="new"
        balanceSessionDraft={{ label: "", access_token: "", auth_kind: "browser_session", user_id: "" }}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onBrowserLogin={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain("浏览器登录");
    expect(html).toContain("高级兼容：PAT / Access Token");
    expect(html).toContain("Access Token / PAT");
    expect(html).toContain("待登录");
    expect(html).not.toContain("登录状态由本机浏览器安全保存");
    expect(html).not.toContain("Session Cookie");
    expect(html).not.toContain("输入 Cookie 或 Session 值");
    expect(html).not.toContain("删除当前会话");
  });

  it("offers a lowest-hole new identity and explicit reuse of stable slots", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onBrowserSlotSelectionChange = vi.fn();

    await act(async () => {
      root.render(
        <SiteBalanceSessionPanel
          siteBalanceSessions={[]}
          balanceSessionSelection="new"
          balanceSessionDraft={{
            label: "",
            access_token: "",
            auth_kind: "browser_session",
            user_id: "",
          }}
          browserIdentitySlots={[
            { slot: 1, browser_session_id: "slot-one" },
            { slot: 3, browser_session_id: "slot-three" },
          ]}
          browserSlotSelection="new"
          onBrowserSlotSelectionChange={onBrowserSlotSelectionChange}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onBrowserLogin={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
        />,
      );
    });

    const identitySelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.parentElement?.textContent?.includes("浏览器身份"),
    );
    expect(identitySelect?.textContent).toContain("新身份（账号2）");
    expect(identitySelect?.textContent).toContain("复用账号1");
    expect(identitySelect?.textContent).toContain("复用账号3");

    await act(async () => {
      if (identitySelect) {
        identitySelect.value = "slot:3";
        identitySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onBrowserSlotSelectionChange).toHaveBeenCalledWith("slot:3");

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders existing session options and delete action when editing an existing session", () => {
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[makeSiteSession("sess-a", "账号1")]}
        balanceSessionSelection="sess-a"
        balanceSessionDraft={{ label: "账号1", access_token: "token-a", auth_kind: "access_token", user_id: "42" }}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onSaveBalanceSession={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain(">API Key 自动<");
    expect(html).toContain("账号1");
    expect(html).toContain("新建会话");
    expect(html).toContain("保存 PAT 账号");
    expect(html).toContain("删除当前会话");
    expect(html).not.toContain("备注名");
  });

  it("does not report an unprobed browser account as logged in", () => {
    const session = {
      ...makeSiteSession("sess-browser", "浏览器账号"),
      access_token: "",
      auth_kind: "browser_session" as const,
      browser_session_id: "browser-slot-1",
      browser_slot: 1,
      browser_origin: "https://new-api.example.com",
    };
    const html = renderToStaticMarkup(
      <SiteBalanceSessionPanel
        siteBalanceSessions={[session]}
        balanceSessionSelection={session.id}
        balanceSessionDraft={{
          label: session.label,
          access_token: "",
          auth_kind: "browser_session",
          user_id: session.user_id,
        }}
        browserAuthStatus="unknown"
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onBrowserLogin={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
      />,
    );

    expect(html).toContain(">未检查<");
    expect(html).not.toContain(">已登录<");
  });

  it("keeps logout and delete actions together in the compact action row", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onBrowserLogout = vi.fn();
    const onDeleteSiteBalanceSession = vi.fn();
    const session = {
      ...makeSiteSession("sess-browser", "浏览器账号"),
      access_token: "",
      auth_kind: "browser_session" as const,
      browser_session_id: "browser-slot-1",
      browser_slot: 1,
      browser_origin: "https://new-api.example.com",
    };

    await act(async () => {
      root.render(
        <SiteBalanceSessionPanel
          siteBalanceSessions={[session]}
          balanceSessionSelection={session.id}
          balanceSessionDraft={{ label: session.label, access_token: "", auth_kind: "browser_session", user_id: "42" }}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onBrowserLogin={vi.fn()}
          onBrowserLogout={onBrowserLogout}
          onDeleteSiteBalanceSession={onDeleteSiteBalanceSession}
        />,
      );
    });

    const actionRow = container.querySelector(".balance-session-actions");
    const logoutButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "退出登录",
    );
    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "删除当前会话",
    );

    expect(actionRow).toBeInstanceOf(HTMLDivElement);
    expect(logoutButton?.parentElement).toBe(actionRow);
    expect(deleteButton?.parentElement).toBe(actionRow);

    await act(async () => {
      logoutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBrowserLogout).toHaveBeenCalledTimes(1);
    expect(onDeleteSiteBalanceSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
