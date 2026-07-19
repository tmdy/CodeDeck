import { describe, expect, it } from "vitest";
import { resolveProjectStatusKey } from "./project-status.js";

describe("project status helpers", () => {
  it("returns no-project when there is no project context", () => {
    expect(resolveProjectStatusKey(undefined)).toBe("no-project");
  });

  it("distinguishes not-in-project from enabled and conflict states", () => {
    expect(
      resolveProjectStatusKey({
        isEnabledInProject: false,
        projectConflict: false,
        projectTargetPath: "C:/demo",
      }),
    ).toBe("not-in-project");

    expect(
      resolveProjectStatusKey({
        isEnabledInProject: true,
        projectConflict: false,
        projectTargetPath: "C:/demo",
      }),
    ).toBe("enabled-in-project");

    expect(
      resolveProjectStatusKey({
        isEnabledInProject: true,
        projectConflict: true,
        projectTargetPath: "C:/demo",
      }),
    ).toBe("project-conflict");
  });
});
