import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import type { Rect, Virtualizer } from "@tanstack/react-virtual";
import type {
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
  SkillsSnapshotResult,
} from "../../shared/skills-service.js";
import type {
  BatchExecutionResult,
  ProjectBatchAction,
  ProjectSkillRecord,
  SkillHost,
  SkillRecord,
  SkillStatus,
} from "../../shared/types.js";
import { formatSkillLocationLabel } from "../../shared/skill-location.js";
import { normalizeUserTags } from "../../shared/record-search.js";
import {
  buildSkillsViewState,
  NO_USER_TAGS_FILTER_VALUE,
  type SkillsRowView,
  type SkillsViewFilters,
} from "../../shared/skills-ui-state.js";

type PreviewState =
  | { kind: "environment"; action: "enable" | "disable"; data: PreviewResult }
  | { kind: "project"; action: ProjectBatchAction; host: SkillHost; data: ProjectPreviewResult }
  | null;

interface SkillsPanelProps {
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  statusMessage?: {
    variant: "success" | "error";
    text: string;
    onDismiss: () => void;
  } | null;
}

const STATUS_FILTERS: Array<{ key: SkillStatus; label: string }> = [
  { key: "active", label: "已启用" },
  { key: "inactive", label: "未启用" },
  { key: "readonly", label: "只读" },
  { key: "conflict", label: "冲突" },
];

const INITIAL_FILTERS: SkillsViewFilters = {
  host: "all",
  statuses: [],
  query: "",
  selectedTag: "",
  onlyTagged: false,
  includeReadonlyOnly: false,
};

const SKILL_ROW_ESTIMATED_SIZE = 106;
const SKILLS_LIST_FALLBACK_RECT: Rect = {
  width: 800,
  height: 720,
};

function observeSkillsListRect(
  instance: Virtualizer<HTMLDivElement, Element>,
  callback: (rect: Rect) => void,
) {
  const unsubscribe = observeElementRect(instance, (rect) => {
    callback(rect.height > 0 ? rect : SKILLS_LIST_FALLBACK_RECT);
  });
  callback(SKILLS_LIST_FALLBACK_RECT);
  return unsubscribe;
}

let lastSkillsSnapshot: SkillsSnapshotResult | null = null;
let initialCachedSnapshotPromise: Promise<SkillsSnapshotResult | null> | null = null;
let initialFreshSnapshotPromise: Promise<SkillsSnapshotResult> | null = null;

export function resetSkillsPanelSnapshotCacheForTests() {
  lastSkillsSnapshot = null;
  initialCachedSnapshotPromise = null;
  initialFreshSnapshotPromise = null;
}

function getInitialSnapshotPromises(): {
  cached: Promise<SkillsSnapshotResult | null>;
  fresh: Promise<SkillsSnapshotResult>;
} {
  if (!window.codeDeckSkills) {
    throw new Error("当前环境未注入 Skills API，请通过 Electron 运行。");
  }
  if (!initialFreshSnapshotPromise || !initialCachedSnapshotPromise) {
    initialCachedSnapshotPromise = window.codeDeckSkills.loadCachedSnapshot()
      .then((cached) => {
        if (cached) {
          lastSkillsSnapshot = cached;
        }
        return cached;
      });
    initialFreshSnapshotPromise = initialCachedSnapshotPromise
      .then(() => window.codeDeckSkills!.refreshSnapshot())
      .then((fresh) => {
        lastSkillsSnapshot = fresh;
        return fresh;
      })
      .finally(() => {
        initialCachedSnapshotPromise = null;
        initialFreshSnapshotPromise = null;
      });
  }
  return {
    cached: initialCachedSnapshotPromise,
    fresh: initialFreshSnapshotPromise,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSkillStatus(status: SkillStatus): string {
  switch (status) {
    case "active":
      return "已启用";
    case "inactive":
      return "未启用";
    case "readonly":
      return "只读";
    case "conflict":
      return "冲突";
    default:
      return status;
  }
}

function uniqueHosts(hosts: SkillHost[]): SkillHost[] {
  return [...new Set(hosts)];
}

function applyUserTagsToRecord<T extends Pick<SkillRecord, "skillId" | "userTags" | "hasUserTags">>(
  record: T,
  skillId: string,
  userTags: string[],
): T {
  if (record.skillId !== skillId) {
    return record;
  }
  return {
    ...record,
    userTags,
    hasUserTags: userTags.length > 0,
  };
}

function applyUserTagsToScan(scan: ScanResult, skillId: string, userTags: string[]): ScanResult {
  return {
    ...scan,
    records: scan.records.map((record) => applyUserTagsToRecord(record, skillId, userTags)),
  };
}

function applyUserTagsToProjectScan(
  projectScan: ProjectScanResult | null,
  skillId: string,
  userTags: string[],
): ProjectScanResult | null {
  if (!projectScan) {
    return null;
  }
  return {
    ...projectScan,
    records: projectScan.records.map((record: ProjectSkillRecord) => applyUserTagsToRecord(record, skillId, userTags)),
  };
}

interface SkillListRowProps {
  item: SkillsRowView;
  active: boolean;
  selected: boolean;
  selectable: boolean;
  onSelect: (skillId: string) => void;
  onToggleSelected: (skillId: string) => void;
}

const SkillListRow = memo(function SkillListRow({
  item,
  active,
  selected,
  selectable,
  onSelect,
  onToggleSelected,
}: SkillListRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(item.skillId);
  }, [item.skillId, onSelect]);

  const handleToggleSelected = useCallback(() => {
    if (!selectable) {
      return;
    }
    onToggleSelected(item.skillId);
  }, [item.skillId, onToggleSelected, selectable]);

  const handleCheckboxClick = useCallback((event: MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <button
      type="button"
      className={`skills-row ${active ? "active" : ""}`}
      onClick={handleSelect}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={!selectable}
        onChange={handleToggleSelected}
        onClick={handleCheckboxClick}
      />
      <div className="skills-row-main">
        <div className="skills-row-title">
          <strong>{item.record.displayName}</strong>
          <span className={`status-pill ${item.status}`}>{formatSkillStatus(item.status)}</span>
          <span className={`status-pill project ${item.projectStatusKey}`}>{item.projectStatusLabel}</span>
        </div>
        <div className="skills-row-meta">
          <span>{item.host}</span>
          <span>{item.record.directoryName}</span>
          <span>{formatBytes(item.record.sizeTotalBytes)}</span>
        </div>
        <p>{item.record.summary || item.record.description || "暂无摘要。"}</p>
        {item.tags.length > 0 && (
          <div className="skills-tags">
            {item.tags.map((tag) => (
              <span key={`${item.skillId}-${tag}`} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
});

export function SkillsPanel({ onError, onSuccess, statusMessage = null }: SkillsPanelProps) {
  const [scan, setScan] = useState<ScanResult | null>(lastSkillsSnapshot?.scan ?? null);
  const [projectScan, setProjectScan] = useState<ProjectScanResult | null>(lastSkillsSnapshot?.projectScan ?? null);
  const [filters, setFilters] = useState<SkillsViewFilters>(INITIAL_FILTERS);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [detailSkillId, setDetailSkillId] = useState<string>("");
  const [tagDraft, setTagDraft] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [lastExecution, setLastExecution] = useState<BatchExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotSource, setSnapshotSource] = useState<SkillsSnapshotResult["source"] | null>(lastSkillsSnapshot?.source ?? null);
  const skillsListRef = useRef<HTMLDivElement | null>(null);

  const viewState = useMemo(() => {
    if (!scan) {
      return null;
    }
    return buildSkillsViewState({
      scan,
      projectScan,
      filters,
    });
  }, [filters, projectScan, scan]);

  const visibleRecords = viewState?.visibleRecords ?? [];
  const selectedSkillIdSet = useMemo(() => new Set(selectedSkillIds), [selectedSkillIds]);
  const selectedRows = useMemo(
    () => visibleRecords.filter((item) => selectedSkillIdSet.has(item.skillId)),
    [selectedSkillIdSet, visibleRecords],
  );
  const selectableVisibleRecords = useMemo(
    () => visibleRecords.filter((item) => item.actions.canEnable || item.actions.canDisable),
    [visibleRecords],
  );
  const selectedHosts = uniqueHosts(selectedRows.map((item) => item.host));
  const selectedProjectHost = selectedHosts.length === 1 ? selectedHosts[0] : null;
  const detailRow = useMemo(
    () => visibleRecords.find((item) => item.skillId === detailSkillId) ?? visibleRecords[0] ?? null,
    [detailSkillId, visibleRecords],
  );
  const rowVirtualizer = useVirtualizer({
    count: visibleRecords.length,
    getScrollElement: () => skillsListRef.current,
    estimateSize: () => SKILL_ROW_ESTIMATED_SIZE,
    getItemKey: (index) => visibleRecords[index]?.skillId ?? index,
    overscan: 6,
    initialRect: SKILLS_LIST_FALLBACK_RECT,
    observeElementRect: observeSkillsListRect,
    measureElement: (element) => element.getBoundingClientRect().height || SKILL_ROW_ESTIMATED_SIZE,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (lastSkillsSnapshot) {
      applySnapshot(lastSkillsSnapshot, { preserveExecution: true });
      return;
    }
    void loadInitialSnapshot();
  }, []);

  useEffect(() => {
    setPreviewState(null);
  }, [selectedSkillIds]);

  useEffect(() => {
    const selectableSkillIds = new Set(selectableVisibleRecords.map((item) => item.skillId));
    setSelectedSkillIds((current) => {
      const next = current.filter((skillId) => selectableSkillIds.has(skillId));
      if (next.length === current.length) {
        return current;
      }
      return next;
    });
  }, [selectableVisibleRecords]);

  useEffect(() => {
    if (!detailRow) {
      setTagDraft("");
      setDetailSkillId("");
      return;
    }
    setDetailSkillId(detailRow.skillId);
    setTagDraft(detailRow.record.userTags.join(", "));
  }, [detailRow?.skillId]);

  function applySnapshot(snapshot: SkillsSnapshotResult, options: { preserveExecution?: boolean } = {}) {
    lastSkillsSnapshot = snapshot;
    setScan(snapshot.scan);
    setProjectScan(snapshot.projectScan);
    setSnapshotSource(snapshot.source);
    setSelectedSkillIds([]);
    setPreviewState(null);
    if (!options.preserveExecution) {
      setLastExecution(null);
    }
  }

  async function loadInitialSnapshot() {
    if (!window.codeDeckSkills) {
      onError("当前环境未注入 Skills API，请通过 Electron 运行。");
      return;
    }

    setRefreshing(true);
    try {
      const { cached: cachedPromise, fresh: freshPromise } = getInitialSnapshotPromises();
      const cached = await cachedPromise;
      if (cached) {
        applySnapshot(cached);
      }
      const fresh = await freshPromise;
      applySnapshot(fresh);
    } catch (error) {
      onError(error instanceof Error ? error.message : "扫描 Skills 失败。");
    } finally {
      setRefreshing(false);
    }
  }

  async function reloadAll(options: { preserveExecution?: boolean } = {}) {
    if (!window.codeDeckSkills) {
      onError("当前环境未注入 Skills API，请通过 Electron 运行。");
      return;
    }

    setRefreshing(true);
    try {
      const fresh = await window.codeDeckSkills.refreshSnapshot();
      applySnapshot(fresh, options);
    } catch (error) {
      onError(error instanceof Error ? error.message : "扫描 Skills 失败。");
    } finally {
      setRefreshing(false);
    }
  }

  function toggleStatusFilter(status: SkillStatus) {
    setFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }));
  }

  const handleSelectSkillDetail = useCallback((skillId: string) => {
    setDetailSkillId(skillId);
  }, []);

  const toggleSelectedSkill = useCallback((skillId: string) => {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((item) => item !== skillId)
        : [...current, skillId]
    ));
  }, []);

  const handleSelectAllVisible = useCallback(() => {
    setSelectedSkillIds(selectableVisibleRecords.map((item) => item.skillId));
  }, [selectableVisibleRecords]);

  const handleClearSelection = useCallback(() => {
    setSelectedSkillIds([]);
  }, []);

  async function handleSaveTags() {
    if (!window.codeDeckSkills || !detailRow) {
      return;
    }

    setBusy(true);
    try {
      const nextTags = tagDraft
        .split(",")
        .map((item) => item.trim());
      const normalizedTags = normalizeUserTags(nextTags);
      await window.codeDeckSkills.updateSkillUserTags(detailRow.skillId, normalizedTags);
      const nextScan = scan ? applyUserTagsToScan(scan, detailRow.skillId, normalizedTags) : scan;
      const nextProjectScan = applyUserTagsToProjectScan(projectScan, detailRow.skillId, normalizedTags);
      setScan(nextScan);
      setProjectScan(nextProjectScan);
      setTagDraft(normalizedTags.join(", "));
      if (nextScan) {
        const nextSnapshot: SkillsSnapshotResult = {
          scan: nextScan,
          projectScan: nextProjectScan,
          source: snapshotSource ?? lastSkillsSnapshot?.source ?? "fresh",
        };
        lastSkillsSnapshot = nextSnapshot;
      }
      onSuccess(`已更新 ${detailRow.record.displayName} 的用户标签。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存标签失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handlePickProject() {
    if (!window.codeDeckSkills) {
      return;
    }

    setBusy(true);
    try {
      const picked = await window.codeDeckSkills.pickProjectDirectory();
      if (!picked) {
        return;
      }
      await window.codeDeckSkills.selectProject(picked);
      const nextProjectScan = await window.codeDeckSkills.scanProject();
      setProjectScan(nextProjectScan);
      setPreviewState(null);
      onSuccess(`已切换到项目：${nextProjectScan?.currentProject.projectName ?? picked}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "选择项目失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearProject() {
    if (!window.codeDeckSkills) {
      return;
    }

    setBusy(true);
    try {
      // 先清空前端状态
      setProjectScan(null);
      setSelectedSkillIds([]);
      setDetailSkillId("");
      setFilters(INITIAL_FILTERS);
      setPreviewState(null);
      setLastExecution(null);

      // 再清空后端持久化状态
      await window.codeDeckSkills.clearCurrentProjectSelection();

      onSuccess("已返回全局 Skills 管理。");
    } catch (error) {
      onError(error instanceof Error ? error.message : "清空项目失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleScanProject() {
    if (!window.codeDeckSkills) {
      return;
    }

    setBusy(true);
    try {
      const nextProjectScan = await window.codeDeckSkills.scanProject();
      setProjectScan(nextProjectScan);
      setPreviewState(null);
      if (nextProjectScan) {
        onSuccess(`已刷新项目：${nextProjectScan.currentProject.projectName}`);
      } else {
        onError("当前没有已选项目。");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "刷新项目状态失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnvironmentPreview(action: "enable" | "disable") {
    if (!window.codeDeckSkills) {
      return;
    }

    setBusy(true);
    try {
      const preview = await window.codeDeckSkills.createPreview(action, selectedSkillIds);
      setPreviewState({
        kind: "environment",
        action,
        data: preview,
      });
      setLastExecution(null);
      onSuccess(`已生成${action === "enable" ? "启用" : "停用"}预览。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "生成环境预览失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleProjectPreview(action: ProjectBatchAction) {
    if (!window.codeDeckSkills || !selectedProjectHost) {
      return;
    }

    setBusy(true);
    try {
      const preview = await window.codeDeckSkills.createProjectPreview(
        selectedProjectHost,
        selectedSkillIds,
        action,
      );
      setPreviewState({
        kind: "project",
        action,
        host: selectedProjectHost,
        data: preview,
      });
      setLastExecution(null);
      onSuccess(`已生成项目${action === "copy-to-project" ? "加入" : "移出"}预览。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "生成项目预览失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecutePreview() {
    if (!window.codeDeckSkills || !previewState) {
      return;
    }

    setBusy(true);
    try {
      const result = previewState.kind === "environment"
        ? await window.codeDeckSkills.executeBatch(previewState.action, previewState.data.items.map((item) => item.skillId))
        : await window.codeDeckSkills.executeProjectBatch(
          previewState.host,
          previewState.data.items.map((item) => item.skillId),
          previewState.action,
        );
      setLastExecution(result);
      setPreviewState(null);
      await reloadAll({ preserveExecution: true });
      if (result.success) {
        onSuccess(result.message);
      } else {
        onError(result.message);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "执行批次失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleRollback() {
    if (!window.codeDeckSkills) {
      return;
    }

    setBusy(true);
    try {
      const result = await window.codeDeckSkills.rollbackLastBatch();
      setLastExecution(result);
      await reloadAll({ preserveExecution: true });
      if (result.success) {
        onSuccess(result.message);
      } else {
        onError(result.message);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "回滚失败。");
    } finally {
      setBusy(false);
    }
  }

  if (!scan || !viewState) {
    return (
      <section className="skills-loading glass-card">
        <h2>Skills 管理</h2>
        <p className="muted">正在加载 Skills 环境信息…</p>
      </section>
    );
  }

  return (
    <section className="skills-layout">
      <div className="skills-refresh-status glass-card">
        <div className="skills-refresh-summary">
          <span className="skills-refresh-title">扫描状态</span>
          {statusMessage && (
            <button
              type="button"
              className={`skills-inline-status ${statusMessage.variant}`}
              onClick={statusMessage.onDismiss}
              title="点击清除"
            >
              {statusMessage.text}
            </button>
          )}
          <span className="muted">
            上次扫描：{new Date(scan.scannedAt).toLocaleString()}
          </span>
        </div>
        <span className="project-pill">
          {refreshing
            ? snapshotSource === "cache" ? "缓存数据，后台刷新中" : "正在扫描"
            : snapshotSource === "cache" ? "缓存数据" : "已刷新"}
        </span>
      </div>

      <div className="skills-overview">
        {viewState.overview.map((item) => (
          <article key={item.host} className="glass-card skills-overview-card">
            <div className="skills-overview-header">
              <div>
                <p className="eyebrow">{item.host === "codex" ? "Codex" : "Claude"}</p>
                <h3>{formatBytes(item.totalBytes)}</h3>
              </div>
              <button type="button" className="secondary-button small" onClick={() => setFilters((current) => ({ ...current, host: item.host }))}>
                仅看此宿主
              </button>
            </div>
            <div className="skills-overview-stats">
              <span>启用 {item.counts.active}</span>
              <span>未启用 {item.counts.inactive}</span>
              <span>只读 {item.counts.readonly}</span>
              <span>冲突 {item.counts.conflict}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="skills-main-grid">
        <aside className="skills-filters glass-card">
          <div className="skills-panel-header">
            <h2>筛选</h2>
            <div className="skills-action-row">
              {!viewState.project.hasProject && (
                <button type="button" className="secondary-button small" onClick={handlePickProject} disabled={busy}>
                  选择项目
                </button>
              )}
              <button type="button" className="secondary-button small" onClick={() => void reloadAll()} disabled={busy}>
                重新扫描
              </button>
            </div>
          </div>

          <label className="field-label">
            <span>关键词</span>
            <input
              type="text"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="空格支持多词，-词排除；匹配名称/摘要/路径/用户标签"
            />
          </label>

          <label className="field-label">
            <span>宿主</span>
            <select
              value={filters.host}
              onChange={(event) => setFilters((current) => ({ ...current, host: event.target.value as SkillsViewFilters["host"] }))}
            >
              <option value="all">全部</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>

          <div className="skills-status-filter">
            <span className="section-label">状态</span>
            <div className="skills-status-chips">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`chip-button ${filters.statuses.includes(item.key) ? "active" : ""}`}
                  onClick={() => toggleStatusFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.onlyTagged}
              onChange={(event) => setFilters((current) => ({
                ...current,
                onlyTagged: event.target.checked,
                selectedTag: event.target.checked && current.selectedTag === NO_USER_TAGS_FILTER_VALUE ? "" : current.selectedTag,
              }))}
            />
            <span>仅看带用户标签项</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.includeReadonlyOnly}
              onChange={(event) => setFilters((current) => ({ ...current, includeReadonlyOnly: event.target.checked }))}
            />
            <span>仅看系统/只读项</span>
          </label>

          <label className="field-label">
            <span>用户标签</span>
            <select
              value={filters.selectedTag}
              onChange={(event) => {
                const selectedTag = event.target.value;
                setFilters((current) => ({
                  ...current,
                  selectedTag,
                  onlyTagged: selectedTag === NO_USER_TAGS_FILTER_VALUE ? false : current.onlyTagged,
                }));
              }}
            >
              <option value="">全部用户标签</option>
              <option value={NO_USER_TAGS_FILTER_VALUE}>无用户标签</option>
              {viewState.availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          {viewState.project.hasProject && (
            <div className="skills-project-box">
              <div className="skills-panel-header">
                <h3>项目态</h3>
                <span className="project-pill">已启用</span>
              </div>
              <p className="muted">
                {viewState.project.currentProjectName} · {viewState.project.currentProjectPath}
              </p>
              <div className="skills-action-row">
                <button type="button" className="secondary-button small" onClick={handlePickProject} disabled={busy}>
                  选择项目
                </button>
                <button type="button" className="secondary-button small" onClick={handleScanProject} disabled={busy}>
                  扫描项目
                </button>
                <button type="button" className="secondary-button small" onClick={handleClearProject} disabled={busy}>
                  返回全局
                </button>
              </div>
            </div>
          )}
        </aside>

        <section className="skills-list glass-card">
          <div className="skills-panel-header">
            <div>
              <h2>Skills 列表</h2>
              <p className="muted">当前可见 {visibleRecords.length} 项，已选择 {selectedSkillIds.length} 项。</p>
            </div>
            <div className="skills-action-row">
              <button
                type="button"
                className="secondary-button small"
                onClick={handleSelectAllVisible}
                disabled={busy || selectableVisibleRecords.length === 0}
              >
                全选当前列表
              </button>
              <button
                type="button"
                className="secondary-button small"
                onClick={handleClearSelection}
                disabled={busy || selectedSkillIds.length === 0}
              >
                清空选择
              </button>
            </div>
          </div>

          <div className="skills-list-toolbar">
            <div className="skills-action-row">
              <button type="button" onClick={() => handleEnvironmentPreview("enable")} disabled={busy || selectedSkillIds.length === 0}>
                启用选中
              </button>
              <button type="button" onClick={() => handleEnvironmentPreview("disable")} disabled={busy || selectedSkillIds.length === 0}>
                停用选中
              </button>
              <button
                type="button"
                className="launch-btn primary"
                onClick={handleExecutePreview}
                disabled={busy || previewState?.kind !== "environment"}
              >
                确认执行
              </button>
              <button type="button" className="secondary-button" onClick={handleRollback} disabled={busy}>
                回滚上一次批次
              </button>
            </div>
          </div>

          <div className="skills-list-body" ref={skillsListRef}>
            {visibleRecords.length > 0 && (
              <div
                className="skills-virtual-list"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {virtualRows.map((virtualRow) => {
                  const item = visibleRecords[virtualRow.index];
                  if (!item) {
                    return null;
                  }
                  return (
                    <div
                      key={virtualRow.key}
                      className="skills-virtual-row"
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <SkillListRow
                        item={item}
                        active={detailRow?.skillId === item.skillId}
                        selected={selectedSkillIdSet.has(item.skillId)}
                        selectable={item.actions.canEnable || item.actions.canDisable}
                        onSelect={handleSelectSkillDetail}
                        onToggleSelected={toggleSelectedSkill}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {visibleRecords.length === 0 && (
              <div className="skills-empty-state">
                <h3>没有匹配结果</h3>
                <p className="muted">调整宿主、状态或标签筛选后再试。</p>
              </div>
            )}
          </div>
        </section>

        <aside className="skills-detail glass-card">
          <div className="skills-panel-header">
            <h2>详情与操作</h2>
            {busy && <span className="project-pill">处理中</span>}
          </div>

          {detailRow ? (
            <>
              <div className="skills-detail-section">
                <h3>{detailRow.record.displayName}</h3>
                <p className="muted">{detailRow.record.description || "暂无描述。"}</p>
                <div className="skills-detail-grid">
                  <span>Skill ID</span>
                  <code>{detailRow.skillId}</code>
                  <span>目录</span>
                  <code>{detailRow.record.directoryName}</code>
                  <span>当前位置</span>
                  <code>{formatSkillLocationLabel(detailRow.record.location)}</code>
                  <span>来源路径</span>
                  <code>{detailRow.record.sourcePath}</code>
                  <span>激活路径</span>
                  <code>{detailRow.record.expectedActivePath}</code>
                  <span>仓库路径</span>
                  <code>{detailRow.record.expectedLibraryPath}</code>
                  <span>项目路径</span>
                  <code>{detailRow.record.projectStatus.projectTargetPath || "-"}</code>
                </div>
                {detailRow.record.notes.length > 0 && (
                  <div className="skills-note-list">
                    {detailRow.record.notes.map((note) => (
                      <p key={note} className="helper-copy">{note}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="skills-detail-section">
                <div className="field-label">
                  <span>当前用户标签</span>
                  {detailRow.record.userTags.length > 0 ? (
                    <div className="skills-tags">
                      {detailRow.record.userTags.map((tag) => (
                        <span key={`${detailRow.skillId}-detail-${tag}`} className="tag-chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">暂无用户标签</p>
                  )}
                </div>
                <label className="field-label">
                  <span>用户标签（逗号分隔）</span>
                  <input
                    type="text"
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    placeholder="例如：科研写作, 自动化"
                  />
                </label>
                <button type="button" className="secondary-button small" onClick={handleSaveTags} disabled={busy}>
                  保存标签
                </button>
              </div>
            </>
          ) : (
            <div className="skills-empty-state">
              <h3>暂无详情</h3>
              <p className="muted">从左侧列表中选择一项即可查看详情。</p>
            </div>
          )}

          {viewState.project.hasProject && (
            <div className="skills-detail-section">
              <h3>项目操作</h3>
              <div className="skills-action-grid">
                <button
                  type="button"
                  onClick={() => handleProjectPreview("copy-to-project")}
                  disabled={busy || selectedSkillIds.length === 0 || !selectedProjectHost}
                >
                  预览加入项目
                </button>
                <button
                  type="button"
                  onClick={() => handleProjectPreview("remove-from-project")}
                  disabled={busy || selectedSkillIds.length === 0 || !selectedProjectHost}
                >
                  预览移出项目
                </button>
                <button
                  type="button"
                  className="launch-btn primary"
                  onClick={handleExecutePreview}
                  disabled={busy || previewState?.kind !== "project"}
                >
                  执行项目预览
                </button>
              </div>
              {!selectedProjectHost && selectedSkillIds.length > 0 && (
                <p className="helper-copy">项目批量操作要求当前选择项属于同一宿主。</p>
              )}
            </div>
          )}

          <div className="skills-detail-section">
            <h3>预览与结果</h3>
            {previewState ? (
              <div className="skills-preview-card">
                <p>
                  当前预览：
                  {previewState.kind === "environment"
                    ? `环境${previewState.action === "enable" ? "启用" : "停用"}`
                    : `项目${previewState.action === "copy-to-project" ? "加入" : "移出"} (${previewState.host})`}
                </p>
                <p className="muted">
                  可执行 {previewState.data.items.length} 项，
                  阻塞 {previewState.data.blockedSkillIds.length} 项。
                </p>
                <div className="skills-preview-list">
                  {previewState.data.items.slice(0, 8).map((item) => (
                    <div key={`${previewState.kind}-${item.skillId}`} className="skills-preview-item">
                      <strong>{item.directoryName}</strong>
                      <code>{item.sourcePath}</code>
                      <code>{item.targetPath}</code>
                    </div>
                  ))}
                  {previewState.data.items.length > 8 && (
                    <p className="helper-copy">其余 {previewState.data.items.length - 8} 项将在执行时一并处理。</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">尚未生成预览。</p>
            )}

            {lastExecution && (
              <div className="skills-preview-card">
                <p>最近批次：{lastExecution.message}</p>
                <p className="muted">
                  结果 {lastExecution.results.length} 项，{lastExecution.rolledBack ? "已触发回滚" : "未触发回滚"}。
                </p>
              </div>
            )}

            <div className="skills-preview-card compact">
              <p>环境阻塞项：{viewState.selection.blockedEnvironmentSkillIds.length}</p>
              <p>项目阻塞项：{viewState.selection.blockedProjectSkillIds.length}</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
