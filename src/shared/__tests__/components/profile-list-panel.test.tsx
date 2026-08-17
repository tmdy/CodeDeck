// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileListPanel } from "../../../components/profiles/ProfileListPanel.jsx";
import { createOfficialNativeProfile, type Profile } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileListPanel", () => {
  it("filters visible profiles by the active provider", () => {
    const profiles: Profile[] = [
      { provider: "claude", name: "ClaudeOnly", url: "https://claude.example.com", key: "sk-claude" },
      { provider: "codex", name: "CodexOnly", url: "https://codex.example.com", key: "sk-codex" },
    ];

    const html = renderToStaticMarkup(
      <ProfileListPanel
        profiles={profiles}
        activeProvider="codex"
        selectedKey="codex::CodexOnly"
        orderedKeys={["codex::CodexOnly"]}
        balanceEntries={{}}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("CodexOnly");
    expect(html).not.toContain("ClaudeOnly");
  });

  it("pins the official CLI profile above provider profiles", () => {
    const official = createOfficialNativeProfile("codex");
    const profiles: Profile[] = [
      { provider: "codex", name: "Relay", url: "https://relay.example.com", key: "sk-relay" },
      official,
    ];

    const html = renderToStaticMarkup(
      <ProfileListPanel
        profiles={profiles}
        activeProvider="codex"
        selectedKey="codex::Relay"
        orderedKeys={["codex::Relay"]}
        balanceEntries={{}}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html.indexOf("官方 Codex")).toBeGreaterThan(-1);
    expect(html.indexOf("官方 Codex")).toBeLessThan(html.indexOf("Relay"));
  });

  it("renders balance summaries and unsupported markers for each profile row", () => {
    const profiles: Profile[] = [
      { provider: "codex", name: "Paid", url: "https://paid.example.com", key: "sk-paid" },
      { provider: "codex", name: "Unsupported", url: "https://api.openai.com/v1", key: "sk-openai" },
    ];

    const html = renderToStaticMarkup(
      <ProfileListPanel
        profiles={profiles}
        activeProvider="codex"
        selectedKey="codex::Paid"
        orderedKeys={["codex::Paid", "codex::Unsupported"]}
        balanceEntries={{
          "codex::Paid": { status: "success", label: "余额 $12.34" },
          "codex::Unsupported": { status: "unsupported", label: "N/A" },
        }}
        healthEntries={{
          "codex::Paid": { status: "success", label: "可用", title: "渠道健康状态：可用" },
          "codex::Unsupported": { status: "fail", label: "网络", title: "连接失败" },
        }}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("余额 $12.34");
    expect(html).toContain("N/A");
    expect(html).toContain("profile-item-health success");
    expect(html).toContain("可用");
    expect(html).toContain("网络");
  });

  it("does not render legacy connectivity status markers", () => {
    const profiles: Profile[] = [
      { provider: "codex", name: "Relay", url: "https://relay.example.com", key: "sk-relay" },
    ];

    const html = renderToStaticMarkup(
      <ProfileListPanel
        profiles={profiles}
        activeProvider="codex"
        selectedKey="codex::Relay"
        orderedKeys={["codex::Relay"]}
        balanceEntries={{}}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).not.toContain("profile-item-status");
  });

  it("renders provider groups and hides members of collapsed groups", () => {
    const profiles: Profile[] = [
      { provider: "codex", name: "Visible", url: "https://visible.example.com", key: "sk-visible" },
      { provider: "codex", name: "Standby", url: "https://standby.example.com", key: "sk-standby" },
    ];

    const html = renderToStaticMarkup(
      <ProfileListPanel
        profiles={profiles}
        activeProvider="codex"
        selectedKey="codex::Standby"
        orderedKeys={["codex::Visible", "codex::Standby"]}
        organization={{
          groups: [{
            id: "standby",
            name: "备用站点",
            profile_keys: ["codex::Standby"],
            collapsed: true,
          }],
          ungrouped_profile_keys: ["codex::Visible"],
          ungrouped_collapsed: false,
        }}
        balanceEntries={{}}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onOrganizationChange={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("未分组");
    expect(html).toContain("备用站点");
    expect(html).toContain("Visible");
    expect(html).not.toContain(">Standby<");
    expect(html).toContain("contains-selected");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("按住上下拖动组");
  });

  it("creates a group through the inline editor", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOrganizationChange = vi.fn();
    const profiles: Profile[] = [
      { provider: "codex", name: "Relay", url: "https://relay.example.com", key: "sk-relay" },
    ];

    await act(async () => {
      root.render(
        <ProfileListPanel
          profiles={profiles}
          activeProvider="codex"
          selectedKey="codex::Relay"
          orderedKeys={["codex::Relay"]}
          balanceEntries={{}}
          onSelect={vi.fn()}
          onReorder={vi.fn()}
          onOrganizationChange={onOrganizationChange}
          onCreate={vi.fn()}
          onClone={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });

    const createGroupButton = container.querySelector<HTMLButtonElement>(
      'button[title="新建组"]',
    );
    await act(async () => {
      createGroupButton?.click();
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="组名"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "公益站点");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });

    expect(onOrganizationChange).toHaveBeenCalledTimes(1);
    expect(onOrganizationChange.mock.calls[0][0]).toMatchObject({
      groups: [{ name: "公益站点", profile_keys: [], collapsed: false }],
      ungrouped_profile_keys: ["codex::Relay"],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("indexes provider profiles before applying ordered keys", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "profiles", "ProfileListPanel.tsx"), "utf8");

    expect(source).toContain("new Map(userProfiles.map(");
    expect(source).not.toContain("providerProfiles.find((p) => itemKey(p) === k)");
  });
});
