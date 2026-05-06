import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readJson } from "./filesystem.js";
import { SkillsManagerService, removePath } from "./skills-service.js";
import type { AppPaths, SkillUserTagsFile } from "./types.js";

async function createSkill(dirPath: string, skillMd: string, extraFiles: Array<[string, string]> = []): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, "SKILL.md"), skillMd, "utf8");
  for (const [relativePath, content] of extraFiles) {
    const filePath = path.join(dirPath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

function buildTestPaths(root: string): AppPaths {
  return {
    projectRoot: root,
    manifestPath: path.join(root, "app-data", "manifest.json"),
    projectsPath: path.join(root, "app-data", "projects.json"),
    translationsPath: path.join(root, "app-data", "translations.json"),
    tagsPath: path.join(root, "app-data", "tags.json"),
    operationsRoot: path.join(root, "app-data", "operations"),
    backupsRoot: path.join(root, "app-data", "backups"),
    hosts: {
      codex: {
        host: "codex",
        activeRoot: path.join(root, "hosts", "codex"),
        libraryRoot: path.join(root, "library", "codex"),
      },
      claude: {
        host: "claude",
        activeRoot: path.join(root, "hosts", "claude"),
        libraryRoot: path.join(root, "library", "claude"),
      },
    },
  };
}

describe("SkillsManagerService user tags", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0, tempRoots.length).map((root) => removePath(root)));
  });

  it("merges stored user tags into scan results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-tags-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
tags:
  - builtin
---
# Writer
body`,
    );
    const service = new SkillsManagerService(paths);
    await service.updateSkillUserTags("codex:writer", ["科研写作", "音视频"]);

    const scan = await service.scanEnvironment();
    const record = scan.records.find((item) => item.skillId === "codex:writer");

    expect(record?.tags).toEqual(["builtin"]);
    expect(record?.userTags).toEqual(["科研写作", "音视频"]);
    expect(record?.hasUserTags).toBe(true);
  });

  it("returns null for cached snapshot when manifest is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-cache-missing-"));
    tempRoots.push(root);
    const service = new SkillsManagerService(buildTestPaths(root));

    await expect(service.loadCachedSnapshot()).resolves.toBeNull();
  });

  it("loads cached snapshot without touching skill directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-cache-stale-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );
    const service = new SkillsManagerService(paths);
    const fresh = await service.scanEnvironment();

    await removePath(path.join(paths.hosts.codex.activeRoot, "writer"));
    const cached = await service.loadCachedSnapshot();

    expect(cached?.source).toBe("cache");
    expect(cached?.scan.scannedAt).toBe(fresh.scannedAt);
    expect(cached?.scan.records.find((item) => item.skillId === "codex:writer")?.displayName).toBe("Writer Skill");
  });

  it("merges current user tags into cached snapshot records", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-cache-tags-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );
    const service = new SkillsManagerService(paths);
    await service.scanEnvironment();
    await service.updateSkillUserTags("codex:writer", ["缓存标签"]);

    const cached = await service.loadCachedSnapshot();
    const record = cached?.scan.records.find((item) => item.skillId === "codex:writer");

    expect(record?.userTags).toEqual(["缓存标签"]);
    expect(record?.hasUserTags).toBe(true);
  });

  it("ignores translated tags and keeps original parsed tags", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-ignore-translated-tags-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
tags:
  - builtin
---
# Writer
body`,
    );
    await fs.mkdir(path.dirname(paths.translationsPath), { recursive: true });
    await fs.writeFile(
      paths.translationsPath,
      JSON.stringify({
        version: 1,
        updatedAt: "2026-05-04T00:00:00.000Z",
        entries: {
          "codex:writer": {
            translatedDisplayName: "作者技能",
            translatedDescription: "中文描述",
            translatedSummary: "中文摘要",
            translatedTags: ["不应显示"],
          },
        },
      }, null, 2),
      "utf8",
    );

    const service = new SkillsManagerService(paths);
    const scan = await service.scanEnvironment();
    const record = scan.records.find((item) => item.skillId === "codex:writer");

    expect(record?.displayName).toBe("作者技能");
    expect(record?.description).toBe("中文描述");
    expect(record?.summary).toBe("中文摘要");
    expect(record?.tags).toEqual(["builtin"]);
    expect(record?.originalTags).toEqual(["builtin"]);
  });

  it("creates, overwrites and clears tags with trimming and deduplication", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-update-tags-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    const service = new SkillsManagerService(paths);

    await service.updateSkillUserTags("codex:writer", [" 科研写作 ", "", "科研写作", "音视频", "音视频 "]);

    const storedAfterWrite = await readJson<SkillUserTagsFile>(paths.tagsPath);
    expect(storedAfterWrite?.entries["codex:writer"]).toEqual(["科研写作", "音视频"]);

    await service.updateSkillUserTags("codex:writer", ["自动化"]);
    const storedAfterOverwrite = await readJson<SkillUserTagsFile>(paths.tagsPath);
    expect(storedAfterOverwrite?.entries["codex:writer"]).toEqual(["自动化"]);

    await service.updateSkillUserTags("codex:writer", []);
    const storedAfterClear = await readJson<SkillUserTagsFile>(paths.tagsPath);
    expect(storedAfterClear?.entries["codex:writer"]).toBeUndefined();
  });

  it("preserves unrelated project and translation files when writing user tags", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-tags-isolation-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await fs.mkdir(path.dirname(paths.projectsPath), { recursive: true });
    await fs.writeFile(
      paths.projectsPath,
      JSON.stringify({ version: 1, currentProjectId: "p1", records: [], hostStates: {} }, null, 2),
      "utf8",
    );
    await fs.writeFile(
      paths.translationsPath,
      JSON.stringify({ version: 1, updatedAt: "2026-05-03T00:00:00.000Z", entries: {} }, null, 2),
      "utf8",
    );

    const service = new SkillsManagerService(paths);
    await service.updateSkillUserTags("codex:writer", ["科研写作"]);

    const projectsRaw = await fs.readFile(paths.projectsPath, "utf8");
    const translationsRaw = await fs.readFile(paths.translationsPath, "utf8");
    expect(projectsRaw).toContain("\"currentProjectId\": \"p1\"");
    expect(translationsRaw).toContain("\"version\": 1");
  });

  it("can clear current project selection without deleting stored project records", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-clear-project-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    const service = new SkillsManagerService(paths);

    const selected = await service.selectProject(path.join(root, "demo-project"));
    let storedProjects = await readJson<{
      version: number;
      currentProjectId?: string;
      records: Array<{ projectId: string }>;
      hostStates: Record<string, unknown>;
    }>(paths.projectsPath);

    expect(storedProjects?.currentProjectId).toBe(selected.projectId);
    expect(storedProjects?.records).toHaveLength(1);

    await service.clearCurrentProjectSelection();

    storedProjects = await readJson(paths.projectsPath);
    expect(storedProjects?.currentProjectId).toBeUndefined();
    expect(storedProjects?.records).toHaveLength(1);
    expect(storedProjects?.records[0]?.projectId).toBe(selected.projectId);
  });

  it("marks skills in library/codex as inactive with library-root location and library source path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-library-codex-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.libraryRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );

    const service = new SkillsManagerService(paths);
    const scan = await service.scanEnvironment();
    const record = scan.records.find((item) => item.skillId === "codex:writer");

    expect(record).toMatchObject({
      status: "inactive",
      location: "library-root",
      sourcePath: path.join(paths.hosts.codex.libraryRoot, "writer"),
      expectedLibraryPath: path.join(paths.hosts.codex.libraryRoot, "writer"),
      expectedActivePath: path.join(paths.hosts.codex.activeRoot, "writer"),
    });
  });

  it("marks skills in library/claude as inactive with library-root location and enables them from library to active root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-library-claude-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.claude.libraryRoot, "reviewer"),
      `---
name: Reviewer Skill
description: For review.
---
# Reviewer
body`,
    );

    const service = new SkillsManagerService(paths);
    const scan = await service.scanEnvironment();
    const record = scan.records.find((item) => item.skillId === "claude:reviewer");
    const preview = await service.createPreview("enable", ["claude:reviewer"]);

    expect(record).toMatchObject({
      status: "inactive",
      location: "library-root",
      sourcePath: path.join(paths.hosts.claude.libraryRoot, "reviewer"),
    });
    expect(preview.items).toEqual([
      expect.objectContaining({
        skillId: "claude:reviewer",
        sourcePath: path.join(paths.hosts.claude.libraryRoot, "reviewer"),
        targetPath: path.join(paths.hosts.claude.activeRoot, "reviewer"),
        statusBefore: "inactive",
        statusAfter: "active",
      }),
    ]);
  });

  it("disables active skills from host root back into library root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-disable-active-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );

    const service = new SkillsManagerService(paths);
    const preview = await service.createPreview("disable", ["codex:writer"]);

    expect(preview.items).toEqual([
      expect.objectContaining({
        skillId: "codex:writer",
        sourcePath: path.join(paths.hosts.codex.activeRoot, "writer"),
        targetPath: path.join(paths.hosts.codex.libraryRoot, "writer"),
        statusBefore: "active",
        statusAfter: "inactive",
      }),
    ]);
  });

  it("copies inactive project skills from library rather than the host root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-project-copy-inactive-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    const projectPath = path.join(root, "demo-project");
    await createSkill(
      path.join(paths.hosts.codex.libraryRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );

    const service = new SkillsManagerService(paths);
    await service.selectProject(projectPath);
    const preview = await service.createProjectPreview("codex", ["codex:writer"], "copy-to-project");

    expect(preview.items).toEqual([
      expect.objectContaining({
        skillId: "codex:writer",
        sourcePath: path.join(paths.hosts.codex.libraryRoot, "writer"),
        targetPath: path.join(projectPath, ".agents", "skills", "writer"),
      }),
    ]);
  });

  it("refreshes snapshot with project state using one environment scan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-refresh-snapshot-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    const projectPath = path.join(root, "demo-project");
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "writer"),
      `---
name: Writer Skill
description: For writing.
---
# Writer
body`,
    );
    await createSkill(
      path.join(projectPath, ".agents", "skills", "writer"),
      `---
name: Writer Skill
description: Project copy.
---
# Writer
body`,
    );
    const service = new SkillsManagerService(paths);
    await service.selectProject(projectPath);

    const snapshot = await service.refreshSnapshot();
    const projectRecord = snapshot.projectScan?.records.find((item) => item.skillId === "codex:writer");

    expect(snapshot.source).toBe("fresh");
    expect(snapshot.scan.records.find((item) => item.skillId === "codex:writer")?.displayName).toBe("Writer Skill");
    expect(projectRecord?.projectStatus.isEnabledInProject).toBe(true);
    expect(projectRecord?.projectStatus.projectTargetPath).toBe(path.join(projectPath, ".agents", "skills", "writer"));
  });

  it("does not allow conflict or readonly items to become environment or project preview items", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-preview-blocked-"));
    tempRoots.push(root);
    const paths = buildTestPaths(root);
    const projectPath = path.join(root, "demo-project");
    await createSkill(
      path.join(paths.hosts.codex.activeRoot, "shared"),
      `---
name: Shared Skill
description: Conflict item.
---
# Shared
body`,
    );
    await createSkill(
      path.join(paths.hosts.codex.libraryRoot, "shared"),
      `---
name: Shared Skill
description: Conflict item.
---
# Shared
body`,
    );
    await createSkill(
      path.join(paths.hosts.codex.libraryRoot, "_readonly"),
      `# readonly`,
    );

    const service = new SkillsManagerService(paths);
    await service.selectProject(projectPath);
    const envPreview = await service.createPreview("enable", ["codex:shared", "codex:_readonly"]);
    const projectPreview = await service.createProjectPreview("codex", ["codex:shared", "codex:_readonly"], "copy-to-project");

    expect(envPreview.items).toEqual([]);
    expect(envPreview.blockedSkillIds.sort()).toEqual(["codex:_readonly", "codex:shared"]);
    expect(projectPreview.items).toEqual([]);
    expect(projectPreview.blockedSkillIds.sort()).toEqual(["codex:_readonly", "codex:shared"]);
  });
});
