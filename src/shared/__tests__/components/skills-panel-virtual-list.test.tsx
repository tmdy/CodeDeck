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

function createRecord(index: number): SkillRecord {
  const directoryName = `skill-${String(index).padStart(3, "0")}`;
  return {
    host: "codex",
    skillId: `codex:${directoryName}`,
    directoryName,
    displayName: `Skill ${index}`,
    description: `Skill ${index} description`,
    summary: `Skill ${index} summary`,
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

function createSnapshot(count: number): SkillsSnapshotResult {
  const records = Array.from({ length: count }, (_, index) => createRecord(index + 1));
  const scan: ScanResult = {
    scannedAt: "2026-05-06T01:00:00.000Z",
    records,
    overview: [
      {
        host: "codex",
        counts: { active: count, inactive: 0, readonly: 0, conflict: 0 },
        totalBytes: records.reduce((sum, record) => sum + record.sizeTotalBytes, 0),
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

  return {
    source: "fresh",
    scan,
    projectScan: null,
  };
}

function createSkillsManager(snapshot: SkillsSnapshotResult): NonNullable<Window["skillsManager"]> {
  return {
    scan: vi.fn(),
    loadCachedSnapshot: vi.fn().mockResolvedValue(null),
    refreshSnapshot: vi.fn().mockResolvedValue(snapshot),
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
  };
}

describe("SkillsPanel virtual list", () => {
  afterEach(() => {
    resetSkillsPanelSnapshotCacheForTests();
    delete window.skillsManager;
  });

  it("renders only a small window of rows while preserving visible count and bulk selection", async () => {
    window.skillsManager = createSkillsManager(createSnapshot(120));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前可见 120 项，已选择 0 项。");
    expect(container.querySelectorAll(".skills-row").length).toBeLessThan(40);

    const firstRow = Array.from(container.querySelectorAll(".skills-row")).find((row) => row.textContent?.includes("Skill 1"));
    expect(firstRow).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      firstRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Skill IDcodex:skill-001");

    const firstCheckbox = firstRow?.querySelector("input[type='checkbox']");
    await act(async () => {
      firstCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("当前可见 120 项，已选择 1 项。");

    const selectAll = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "全选当前列表");
    await act(async () => {
      selectAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("当前可见 120 项，已选择 120 项。");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
