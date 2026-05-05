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
        connectivityStates={{}}
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
});
