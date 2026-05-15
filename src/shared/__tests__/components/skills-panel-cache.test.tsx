// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetSkillsPanelSnapshotCacheForTests,
  SkillsPanel,
} from "../../../components/skills/SkillsPanel.jsx";
import type { ScanResult, SkillsSnapshotResult } from "../../skills-service.js";
import type { SkillRecord } from "../../types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createRecord(directoryName: string, displayName: string): SkillRecord {
  return {
    host: "codex",
    skillId: `codex:${directoryName}`,
    directoryName,
    displayName,
    description: `${displayName} description`,
    summary: `${displayName} summary`,
    tags: [],
    userTags: [],
    hasUserTags: false,
    hasSkillMd: true,
    isSpecialDir: false,
    status: "active",
    location: "active-root",
    sourcePath: `C:/skills/${directoryName}`,
    expectedActivePath: `C:/hosts/codex/${directoryName}`,
    expectedLibraryPath: `C:/library/codex/${directoryName}`,
    sizeSkillMdBytes: 100,
    sizeBodyBytes: 200,
    sizeTotalBytes: 300,
    lastScannedAt: "2026-05-06T01:00:00.000Z",
    notes: [],
  };
}

function createScan(record: SkillRecord, scannedAt: string): ScanResult {
  return {
    scannedAt,
    records: [record],
    overview: [
      {
        host: "codex",
        counts: { active: 1, inactive: 0, readonly: 0, conflict: 0 },
        totalBytes: record.sizeTotalBytes,
        readonlyBytes: 0,
      },
      {
        host: "claude",
        counts: { active: 0, inactive: 0, readonly: 0, conflict: 0 },
        totalBytes: 0,
        readonlyBytes: 0,
      },
    ],
    manifestPath: "C:/app-data/manifest.json",
    projectRoot: "C:/workspace",
  };
}

function createSnapshot(source: SkillsSnapshotResult["source"], record: SkillRecord): SkillsSnapshotResult {
  return {
    source,
    scan: createScan(record, source === "cache" ? "2026-05-06T01:00:00.000Z" : "2026-05-06T02:00:00.000Z"),
    projectScan: null,
  };
}

function createSkillsManager(overrides: Partial<NonNullable<Window["skillsManager"]>>): NonNullable<Window["skillsManager"]> {
  return {
    scan: vi.fn(),
    loadCachedSnapshot: vi.fn(),
    refreshSnapshot: vi.fn(),
    updateSkillUserTags: vi.fn(),
    pickProjectDirectory: vi.fn(),
    selectProject: vi.fn(),
    clearCurrentProjectSelection: vi.fn(),
    scanProject: vi.fn(),
    createPreview: vi.fn(),
    executeBatch: vi.fn(),
    createProjectPreview: vi.fn(),
    executeProjectBatch: vi.fn(),
    rollbackLastBatch: vi.fn(),
    ...overrides,
  };
}

describe("SkillsPanel cached startup", () => {
  afterEach(() => {
    resetSkillsPanelSnapshotCacheForTests();
    delete window.skillsManager;
  });

  it("renders cached records before replacing them with refreshed records", async () => {
    const cachedSnapshot = createSnapshot("cache", createRecord("cached-writer", "Cached Writer"));
    const freshSnapshot = createSnapshot("fresh", createRecord("fresh-writer", "Fresh Writer"));
    let resolveRefresh: (snapshot: SkillsSnapshotResult) => void = () => undefined;
    const refreshPromise = new Promise<SkillsSnapshotResult>((resolve) => {
      resolveRefresh = resolve;
    });
    window.skillsManager = createSkillsManager({
      loadCachedSnapshot: vi.fn().mockResolvedValue(cachedSnapshot),
      refreshSnapshot: vi.fn().mockReturnValue(refreshPromise),
    });
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cached Writer");
    expect(container.textContent).toContain("缓存数据，后台刷新中");

    await act(async () => {
      resolveRefresh(freshSnapshot);
      await refreshPromise;
    });

    expect(container.textContent).toContain("Fresh Writer");
    expect(container.textContent).not.toContain("Cached Writer");
    expect(container.textContent).toContain("已刷新");
  });

  it("reuses the last snapshot when the panel is remounted", async () => {
    const freshSnapshot = createSnapshot("fresh", createRecord("fresh-writer", "Fresh Writer"));
    const skillsManager = createSkillsManager({
      loadCachedSnapshot: vi.fn().mockResolvedValue(null),
      refreshSnapshot: vi.fn().mockResolvedValue(freshSnapshot),
    });
    window.skillsManager = skillsManager;
    const firstContainer = document.createElement("div");
    const firstRoot = createRoot(firstContainer);

    await act(async () => {
      firstRoot.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(firstContainer.textContent).toContain("Fresh Writer");
    await act(async () => {
      firstRoot.unmount();
    });

    const secondContainer = document.createElement("div");
    const secondRoot = createRoot(secondContainer);
    await act(async () => {
      secondRoot.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
    });

    expect(secondContainer.textContent).toContain("Fresh Writer");
    expect(skillsManager.loadCachedSnapshot).toHaveBeenCalledTimes(1);
    expect(skillsManager.refreshSnapshot).toHaveBeenCalledTimes(1);
  });

  it("deduplicates the initial snapshot requests across concurrent mounts", async () => {
    const freshSnapshot = createSnapshot("fresh", createRecord("fresh-writer", "Fresh Writer"));
    let resolveRefresh: (snapshot: SkillsSnapshotResult) => void = () => undefined;
    const refreshPromise = new Promise<SkillsSnapshotResult>((resolve) => {
      resolveRefresh = resolve;
    });
    const skillsManager = createSkillsManager({
      loadCachedSnapshot: vi.fn().mockResolvedValue(null),
      refreshSnapshot: vi.fn().mockReturnValue(refreshPromise),
    });
    window.skillsManager = skillsManager;
    const firstContainer = document.createElement("div");
    const secondContainer = document.createElement("div");
    const firstRoot = createRoot(firstContainer);
    const secondRoot = createRoot(secondContainer);

    await act(async () => {
      firstRoot.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
      secondRoot.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(skillsManager.loadCachedSnapshot).toHaveBeenCalledTimes(1);
    expect(skillsManager.refreshSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh(freshSnapshot);
      await refreshPromise;
    });

    expect(firstContainer.textContent).toContain("Fresh Writer");
    expect(secondContainer.textContent).toContain("Fresh Writer");
  });
});
