// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetSkillsPanelSnapshotCacheForTests,
  SkillsPanel,
} from "../../../components/skills/SkillsPanel.jsx";
import type { PreviewResult, ProjectScanResult, ScanResult, SkillsSnapshotResult } from "../../skills-service.js";
import type { BatchExecutionResult, SkillRecord } from "../../types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createRecord(overrides: Partial<SkillRecord> = {}): SkillRecord {
  const directoryName = overrides.directoryName ?? "workflow-plan";
  return {
    host: "codex",
    skillId: `codex:${directoryName}`,
    directoryName,
    displayName: "Workflow Plan",
    description: "Workflow Plan description",
    summary: "Workflow Plan summary",
    tags: [],
    userTags: [],
    hasUserTags: false,
    hasSkillMd: true,
    isSpecialDir: false,
    status: "inactive",
    location: "library-root",
    sourcePath: `C:/library/codex/${directoryName}`,
    expectedActivePath: `C:/hosts/codex/${directoryName}`,
    expectedLibraryPath: `C:/library/codex/${directoryName}`,
    sizeSkillMdBytes: 100,
    sizeBodyBytes: 200,
    sizeTotalBytes: 300,
    lastScannedAt: "2026-05-06T01:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

function createSnapshot(record: SkillRecord = createRecord()): SkillsSnapshotResult {
  return createSnapshotWithRecords([record]);
}

function createSnapshotWithRecords(records: SkillRecord[]): SkillsSnapshotResult {
  const scan: ScanResult = {
    scannedAt: "2026-05-06T01:00:00.000Z",
    records,
    overview: [
      {
        host: "codex",
        counts: {
          active: records.filter((record) => record.host === "codex" && record.status === "active").length,
          inactive: records.filter((record) => record.host === "codex" && record.status === "inactive").length,
          readonly: records.filter((record) => record.host === "codex" && record.status === "readonly").length,
          conflict: records.filter((record) => record.host === "codex" && record.status === "conflict").length,
        },
        totalBytes: records.filter((record) => record.host === "codex").reduce((sum, record) => sum + record.sizeTotalBytes, 0),
        readonlyBytes: records
          .filter((record) => record.host === "codex" && record.status === "readonly")
          .reduce((sum, record) => sum + record.sizeTotalBytes, 0),
      },
      {
        host: "claude",
        counts: {
          active: records.filter((record) => record.host === "claude" && record.status === "active").length,
          inactive: records.filter((record) => record.host === "claude" && record.status === "inactive").length,
          readonly: records.filter((record) => record.host === "claude" && record.status === "readonly").length,
          conflict: records.filter((record) => record.host === "claude" && record.status === "conflict").length,
        },
        totalBytes: records.filter((record) => record.host === "claude").reduce((sum, record) => sum + record.sizeTotalBytes, 0),
        readonlyBytes: records
          .filter((record) => record.host === "claude" && record.status === "readonly")
          .reduce((sum, record) => sum + record.sizeTotalBytes, 0),
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

function createSnapshotWithProject(record: SkillRecord = createRecord()): SkillsSnapshotResult {
  const snapshot = createSnapshot(record);
  const projectScan: ProjectScanResult = {
    currentProject: {
      projectId: "project-1",
      projectName: "workspace",
      projectPath: "C:/workspace",
      createdAt: "2026-05-06T00:00:00.000Z",
      lastUsedAt: "2026-05-06T01:00:00.000Z",
    },
    hostStates: {
      codex: { skillIds: [], managedSkillIds: [] },
      claude: { skillIds: [], managedSkillIds: [] },
    },
    records: snapshot.scan.records.map((item) => ({
      ...item,
      projectStatus: {
        isEnabledInProject: false,
        projectTargetPath: `C:/workspace/.agents/skills/${item.directoryName}`,
        projectConflict: false,
      },
    })),
  };

  return {
    ...snapshot,
    projectScan,
  };
}

function createEnvironmentPreview(action: "enable" | "disable"): PreviewResult {
  return {
    action,
    generatedAt: "2026-05-06T01:01:00.000Z",
    items: [
      {
        skillId: "codex:workflow-plan",
        host: "codex",
        directoryName: "workflow-plan",
        sourcePath: "C:/library/codex/workflow-plan",
        targetPath: "C:/hosts/codex/workflow-plan",
        sizeTotalBytes: 300,
        statusBefore: "inactive",
        statusAfter: "active",
      },
    ],
    blockedSkillIds: [],
    overview: [
      {
        host: "codex",
        movableCount: 1,
        readonlyCount: 0,
        conflictCount: 0,
        projectedBytesMoved: 300,
      },
    ],
  };
}

function createExecutionResult(): BatchExecutionResult {
  return {
    operationId: "operation-1",
    action: "enable",
    startedAt: "2026-05-06T01:02:00.000Z",
    finishedAt: "2026-05-06T01:02:01.000Z",
    success: true,
    rolledBack: false,
    results: [
      {
        skillId: "codex:workflow-plan",
        host: "codex",
        directoryName: "workflow-plan",
        sourcePath: "C:/library/codex/workflow-plan",
        targetPath: "C:/hosts/codex/workflow-plan",
        sizeTotalBytes: 300,
        statusBefore: "inactive",
        statusAfter: "active",
        success: true,
      },
    ],
    message: "批次执行成功，共处理 1 个 skill。",
  };
}

function createSkillsManager(
  snapshot: SkillsSnapshotResult,
  overrides: Partial<NonNullable<Window["skillsManager"]>> = {},
): NonNullable<Window["skillsManager"]> {
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
    ...overrides,
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === label);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

async function renderPanel(
  manager: NonNullable<Window["skillsManager"]>,
  props: Partial<React.ComponentProps<typeof SkillsPanel>> = {},
) {
  window.skillsManager = manager;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<SkillsPanel onError={vi.fn()} onSuccess={vi.fn()} {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return { container, root };
}

async function cleanup(container: HTMLElement, root: Root) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function selectFirstSkill(container: HTMLElement) {
  const checkbox = container.querySelector(".skills-row input[type='checkbox']");
  expect(checkbox).toBeInstanceOf(HTMLInputElement);
  await act(async () => {
    checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SkillsPanel environment action controls", () => {
  afterEach(() => {
    resetSkillsPanelSnapshotCacheForTests();
    delete window.skillsManager;
  });

  it("keeps global mode free of project state while preserving the project picker entry", async () => {
    const manager = createSkillsManager(createSnapshot());
    const { container, root } = await renderPanel(manager);

    expect(container.textContent).not.toContain("项目态");
    expect(container.textContent).not.toContain("项目操作");
    expect(findButton(container, "选择项目").disabled).toBe(false);

    await cleanup(container, root);
  });

  it("renders operation feedback inside the scan status strip", async () => {
    const manager = createSkillsManager(createSnapshot());
    const { container, root } = await renderPanel(manager, {
      statusMessage: {
        variant: "success",
        text: "已回滚批次 operation-1。",
        onDismiss: vi.fn(),
      },
    });

    const statusStrip = container.querySelector(".skills-refresh-status");
    expect(statusStrip?.textContent).toContain("扫描状态");
    expect(statusStrip?.textContent).toContain("已回滚批次 operation-1。");
    expect(statusStrip?.textContent).toContain("上次扫描");
    expect(container.querySelector(".banner")).toBeNull();

    await cleanup(container, root);
  });

  it("surfaces project refresh errors from the service", async () => {
    const scanProject = vi.fn().mockRejectedValue(new Error("请先刷新全局 Skills 后再刷新项目状态。"));
    const onError = vi.fn();
    const manager = createSkillsManager(createSnapshotWithProject(), { scanProject });
    const { container, root } = await renderPanel(manager, { onError });

    await act(async () => {
      findButton(container, "扫描项目").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scanProject).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("请先刷新全局 Skills 后再刷新项目状态。");

    await cleanup(container, root);
  });

  it("disables environment action buttons until at least one skill is selected", async () => {
    const manager = createSkillsManager(createSnapshot());
    const { container, root } = await renderPanel(manager);

    expect(findButton(container, "启用选中").disabled).toBe(true);
    expect(findButton(container, "停用选中").disabled).toBe(true);
    expect(findButton(container, "确认执行").disabled).toBe(true);

    await cleanup(container, root);
  });

  it("creates an enable preview for selected skills", async () => {
    const createPreview = vi.fn().mockResolvedValue(createEnvironmentPreview("enable"));
    const manager = createSkillsManager(createSnapshot(), { createPreview });
    const { container, root } = await renderPanel(manager);

    await selectFirstSkill(container);
    await act(async () => {
      findButton(container, "启用选中").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createPreview).toHaveBeenCalledWith("enable", ["codex:workflow-plan"]);

    await cleanup(container, root);
  });

  it("selects only environment-actionable skills when selecting the current list", async () => {
    const readonlyRecord = createRecord({
      directoryName: "_shared",
      displayName: "Shared",
      status: "readonly",
      location: "readonly",
      isSpecialDir: true,
    });
    const snapshot = createSnapshotWithRecords([createRecord(), readonlyRecord]);
    const createPreview = vi.fn().mockResolvedValue(createEnvironmentPreview("enable"));
    const manager = createSkillsManager(snapshot, { createPreview });
    const { container, root } = await renderPanel(manager);

    await act(async () => {
      findButton(container, "全选当前列表").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      findButton(container, "启用选中").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("已选择 1 项");
    expect(createPreview).toHaveBeenCalledWith("enable", ["codex:workflow-plan"]);

    await cleanup(container, root);
  });

  it("keeps readonly-only rows unselectable and disables environment actions", async () => {
    const readonlyRecord = createRecord({
      directoryName: "_shared",
      displayName: "Shared",
      status: "readonly",
      location: "readonly",
      isSpecialDir: true,
    });
    const manager = createSkillsManager(createSnapshotWithRecords([readonlyRecord]));
    const { container, root } = await renderPanel(manager);
    const readonlyToggle = Array.from(container.querySelectorAll("input[type='checkbox']"))
      .find((input) => input.parentElement?.textContent?.includes("仅看系统/只读项")) as HTMLInputElement | undefined;
    expect(readonlyToggle).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      readonlyToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const rowCheckbox = container.querySelector(".skills-row input[type='checkbox']") as HTMLInputElement | null;
    expect(rowCheckbox).toBeInstanceOf(HTMLInputElement);
    expect(rowCheckbox?.disabled).toBe(true);
    expect(findButton(container, "全选当前列表").disabled).toBe(true);
    expect(findButton(container, "启用选中").disabled).toBe(true);
    expect(findButton(container, "停用选中").disabled).toBe(true);

    await act(async () => {
      rowCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("已选择 0 项");

    await cleanup(container, root);
  });

  it("creates a disable preview for selected skills", async () => {
    const createPreview = vi.fn().mockResolvedValue(createEnvironmentPreview("disable"));
    const manager = createSkillsManager(createSnapshot(), { createPreview });
    const { container, root } = await renderPanel(manager);

    await selectFirstSkill(container);
    await act(async () => {
      findButton(container, "停用选中").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createPreview).toHaveBeenCalledWith("disable", ["codex:workflow-plan"]);

    await cleanup(container, root);
  });

  it("saves user tags by applying a local overlay without refreshing the snapshot", async () => {
    const snapshot = createSnapshot();
    const refreshSnapshot = vi.fn().mockResolvedValue(snapshot);
    const updateSkillUserTags = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const manager = createSkillsManager(snapshot, {
      refreshSnapshot,
      updateSkillUserTags,
    });
    const { container, root } = await renderPanel(manager, { onSuccess });
    const tagInput = container.querySelector("input[placeholder='例如：科研写作, 自动化']") as HTMLInputElement | null;
    expect(tagInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(tagInput, "科研写作, 自动化, 科研写作");
      tagInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton(container, "保存标签").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateSkillUserTags).toHaveBeenCalledWith("codex:workflow-plan", ["科研写作", "自动化"]);
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("科研写作");
    expect(container.textContent).toContain("自动化");
    expect(container.textContent).not.toContain("暂无用户标签");
    expect(onSuccess).toHaveBeenCalledWith("已更新 Workflow Plan 的用户标签。");

    await cleanup(container, root);
  });

  it("enables confirmation only after an environment preview and executes the preview items", async () => {
    const snapshot = createSnapshot();
    const createPreview = vi.fn().mockResolvedValue(createEnvironmentPreview("enable"));
    const executeBatch = vi.fn().mockResolvedValue(createExecutionResult());
    const refreshSnapshot = vi.fn().mockResolvedValue(snapshot);
    const manager = createSkillsManager(snapshot, {
      createPreview,
      executeBatch,
      refreshSnapshot,
    });
    const { container, root } = await renderPanel(manager);

    expect(findButton(container, "确认执行").disabled).toBe(true);
    await selectFirstSkill(container);
    await act(async () => {
      findButton(container, "启用选中").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmButton = findButton(container, "确认执行");
    expect(confirmButton.disabled).toBe(false);

    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeBatch).toHaveBeenCalledWith("enable", ["codex:workflow-plan"]);

    await cleanup(container, root);
  });
});
