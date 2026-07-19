import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  findNearestWorkspaceRoot,
  initializeWorkspace,
  resolveConfiguredProjectRoot,
  resolveStartupProjectRoot,
  resolveWorkspaceLayout,
} from "./app-workspace.js";
import { removePath } from "./skills-service.js";

describe("app workspace", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => removePath(root)));
  });

  it("uses current repo cwd in dev mode and userData in packaged mode", () => {
    const devResult = resolveWorkspaceLayout({
      cwd: "C:/repo",
      isPackaged: false,
    });
    expect(devResult.workspaceRoot).toBe(path.resolve("C:/repo"));
    expect(devResult.seedRoot).toBeUndefined();

    const devWithUserData = resolveWorkspaceLayout({
      cwd: "C:/repo",
      isPackaged: false,
      userDataPath: "D:/custom-data",
    });
    expect(devWithUserData.workspaceRoot).toBe(path.resolve("C:/repo"));

    expect(
      resolveWorkspaceLayout({
        cwd: "C:/repo",
        isPackaged: true,
        resourcesPath: "C:/Program Files/CodeDeck/resources",
        userDataPath: "C:/Users/test/AppData/Roaming/CodeDeck",
      }),
    ).toEqual({
      workspaceRoot: path.join("C:/Users/test/AppData/Roaming/CodeDeck", "workspace"),
      seedRoot: path.join("C:/Program Files/CodeDeck/resources", "workspace-seed"),
    });
  });

  it("prefers explicit env project root over packaged layout", () => {
    expect(
      resolveWorkspaceLayout({
        cwd: "C:/repo",
        envProjectRoot: "D:/custom-root",
        isPackaged: true,
        resourcesPath: "C:/resources",
        userDataPath: "C:/userdata",
      }),
    ).toEqual({
      workspaceRoot: path.resolve("D:/custom-root"),
    });
  });

  it("resolves configured project root from env before project-root file contents", () => {
    expect(
      resolveConfiguredProjectRoot({
        envProjectRoot: "D:/env-root",
        projectRootFileContents: ["D:/file-root"],
      }),
    ).toBe("D:/env-root");
  });

  it("resolves configured project root from the first non-empty non-comment project-root file line", () => {
    expect(
      resolveConfiguredProjectRoot({
        envProjectRoot: "",
        projectRootFileContents: [
          "  \n# comment\n\nD:/workspace-root\nE:/ignored",
        ],
      }),
    ).toBe("D:/workspace-root");
  });

  it("finds the nearest portable workspace root from executable directories", () => {
    const workspaceRoot = path.resolve("D:/CodeDeck");
    expect(
      findNearestWorkspaceRoot({
        startDirectories: [path.join(workspaceRoot, "release", "win-unpacked")],
        isWorkspaceRoot: (directory) => directory === workspaceRoot,
      }),
    ).toBe(workspaceRoot);
  });

  it("does not invent a portable workspace root when no marker matches", () => {
    expect(
      findNearestWorkspaceRoot({
        startDirectories: ["C:/Program Files/CodeDeck"],
        isWorkspaceRoot: () => false,
      }),
    ).toBeUndefined();
  });

  it("prefers portable roots over stale global environment overrides", () => {
    expect(
      resolveStartupProjectRoot({
        portableWorkspaceRoot: "D:/CodeDeck",
        envProjectRoot: "C:/old/CodeDeck",
      }),
    ).toBe("D:/CodeDeck");
  });

  it("prefers a colocated project-root file over portable detection", () => {
    expect(
      resolveStartupProjectRoot({
        projectRootFileContents: ["E:/configured/CodeDeck"],
        portableWorkspaceRoot: "D:/CodeDeck",
        envProjectRoot: "C:/old/CodeDeck",
      }),
    ).toBe("E:/configured/CodeDeck");
  });

  it("seeds library and translations into packaged workspace only when missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codedeck-workspace-"));
    tempRoots.push(root);
    const seedRoot = path.join(root, "workspace-seed");
    const workspaceRoot = path.join(root, "workspace");

    await fs.mkdir(path.join(seedRoot, "library", "codex", "demo"), { recursive: true });
    await fs.writeFile(path.join(seedRoot, "library", "codex", "demo", "SKILL.md"), "# demo", "utf8");
    await fs.mkdir(path.join(seedRoot, "app-data"), { recursive: true });
    await fs.writeFile(path.join(seedRoot, "app-data", "translations.json"), "{\"version\":1}", "utf8");

    await initializeWorkspace({
      workspaceRoot,
      seedRoot,
    });

    expect(await fs.readFile(path.join(workspaceRoot, "library", "codex", "demo", "SKILL.md"), "utf8")).toBe("# demo");
    expect(await fs.readFile(path.join(workspaceRoot, "app-data", "translations.json"), "utf8")).toContain("\"version\":1");

    await fs.writeFile(path.join(workspaceRoot, "app-data", "translations.json"), "{\"version\":2}", "utf8");
    await initializeWorkspace({
      workspaceRoot,
      seedRoot,
    });

    expect(await fs.readFile(path.join(workspaceRoot, "app-data", "translations.json"), "utf8")).toContain("\"version\":2");
  });
});
