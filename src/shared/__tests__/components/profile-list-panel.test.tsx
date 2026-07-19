import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileListPanel } from "../../../components/profiles/ProfileListPanel.jsx";
import type { Profile } from "../../profile/types.js";

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
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onCreate={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("余额 $12.34");
    expect(html).toContain("N/A");
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

  it("indexes provider profiles before applying ordered keys", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "profiles", "ProfileListPanel.tsx"), "utf8");

    expect(source).toContain("const profileByKey = new Map(");
    expect(source).not.toContain("providerProfiles.find((p) => itemKey(p) === k)");
  });
});
