import { describe, expect, it } from "vitest";
import {
  moveProfileGroup,
  moveProfileInOrganization,
  normalizeProfileOrganization,
  type ProfileOrganization,
} from "../../profile/organization.js";

function makeOrganization(): ProfileOrganization {
  return {
    groups: [
      {
        id: "stable",
        name: "稳定",
        profile_keys: ["codex::A", "codex::B"],
        collapsed: false,
      },
      {
        id: "standby",
        name: "备用",
        profile_keys: ["codex::C"],
        collapsed: true,
      },
    ],
    ungrouped_profile_keys: ["codex::D"],
    ungrouped_collapsed: false,
  };
}

describe("profile organization", () => {
  it("migrates legacy order into the ungrouped section", () => {
    const organization = normalizeProfileOrganization(
      undefined,
      "codex",
      ["codex::B", "codex::A"],
    );

    expect(organization).toEqual({
      groups: [],
      ungrouped_profile_keys: ["codex::B", "codex::A"],
      ungrouped_collapsed: false,
    });
  });

  it("drops duplicate and cross-provider memberships while preserving group state", () => {
    const organization = normalizeProfileOrganization({
      groups: [
        {
          id: " standby ",
          name: " 备用 ",
          profile_keys: ["codex::A", "claude::Wrong", "codex::A"],
          collapsed: true,
        },
      ],
      ungrouped_profile_keys: ["codex::A", "codex::B"],
      ungrouped_collapsed: true,
    }, "codex");

    expect(organization.groups[0]).toEqual({
      id: "standby",
      name: "备用",
      profile_keys: ["codex::A"],
      collapsed: true,
    });
    expect(organization.ungrouped_profile_keys).toEqual(["codex::B"]);
    expect(organization.ungrouped_collapsed).toBe(true);
  });

  it("moves profiles across sections and reorders within a group", () => {
    const moved = moveProfileInOrganization(makeOrganization(), "codex::D", "stable", 1);
    expect(moved.ungrouped_profile_keys).toEqual([]);
    expect(moved.groups[0].profile_keys).toEqual([
      "codex::A",
      "codex::D",
      "codex::B",
    ]);

    const reordered = moveProfileInOrganization(moved, "codex::A", "stable", 3);
    expect(reordered.groups[0].profile_keys).toEqual([
      "codex::D",
      "codex::B",
      "codex::A",
    ]);
  });

  it("reorders groups without changing their members or collapsed state", () => {
    const reordered = moveProfileGroup(makeOrganization(), "stable", 2);

    expect(reordered.groups.map((group) => group.id)).toEqual(["standby", "stable"]);
    expect(reordered.groups[0].collapsed).toBe(true);
    expect(reordered.groups[1].profile_keys).toEqual(["codex::A", "codex::B"]);
  });
});
