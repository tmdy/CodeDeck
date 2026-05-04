import { useEffect, useMemo, useState } from "react";
import type {
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
} from "../../shared/skills-service.js";
import type {
  BatchExecutionResult,
  ProjectBatchAction,
  SkillHost,
  SkillStatus,
} from "../../shared/types.js";
import { formatSkillLocationLabel } from "../../shared/skill-location.js";
import {
  buildSkillsViewState,
  type SkillsViewFilters,
} from "../../shared/skills-ui-state.js";

type PreviewState =
  | { kind: "environment"; action: "enable" | "disable"; data: PreviewResult }
  | { kind: "project"; action: ProjectBatchAction; host: SkillHost; data: ProjectPreviewResult }
  | null;

interface SkillsPanelProps {
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
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

export function SkillsPanel({ onError, onSuccess }: SkillsPanelProps) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [projectScan, setProjectScan] = useState<ProjectScanResult | null>(null);
  const [filters, setFilters] = useState<SkillsViewFilters>(INITIAL_FILTERS);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [detailSkillId, setDetailSkillId] = useState<string>("");
  const [tagDraft, setTagDraft] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [lastExecution, setLastExecution] = useState<BatchExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);

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
  const selectedRows = useMemo(
    () => visibleRecords.filter((item) => selectedSkillIds.includes(item.skillId)),
    [selectedSkillIds, visibleRecords],
  );
  const selectedHosts = uniqueHosts(selectedRows.map((item) => item.host));
  const selectedProjectHost = selectedHosts.length === 1 ? selectedHosts[0] : null;
  const detailRow = useMemo(
    () => visibleRecords.find((item) => item.skillId === detailSkillId) ?? visibleRecords[0] ?? null,
    [detailSkillId, visibleRecords],
  );

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    setPreviewState(null);
  }, [selectedSkillIds]);

  useEffect(() => {
    if (!detailRow) {
      setTagDraft("");
      setDetailSkillId("");
      return;
    }
    setDetailSkillId(detailRow.skillId);
    setTagDraft(detailRow.record.userTags.join(", "));
  }, [detailRow?.skillId]);

  async function reloadAll(options: { preserveExecution?: boolean } = {}) {
    if (!window.skillsManager) {
      onError("当前环境未注入 Skills API，请通过 Electron 运行。");
      return;
    }

    setBusy(true);
    try {
      const [nextScan, nextProjectScan] = await Promise.all([
        window.skillsManager.scan(),
        window.skillsManager.scanProject(),
      ]);
      setScan(nextScan);
      setProjectScan(nextProjectScan);
      setSelectedSkillIds([]);
      setPreviewState(null);
      if (!options.preserveExecution) {
        setLastExecution(null);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "扫描 Skills 失败。");
    } finally {
      setBusy(false);
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

  function toggleSelectedSkill(skillId: string) {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((item) => item !== skillId)
        : [...current, skillId]
    ));
  }

  async function handleSaveTags() {
    if (!window.skillsManager || !detailRow) {
      return;
    }

    setBusy(true);
    try {
      const nextTags = tagDraft
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await window.skillsManager.updateSkillUserTags(detailRow.skillId, nextTags);
      await reloadAll();
      onSuccess(`已更新 ${detailRow.record.displayName} 的用户标签。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存标签失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handlePickProject() {
    if (!window.skillsManager) {
      return;
    }

    setBusy(true);
    try {
      const picked = await window.skillsManager.pickProjectDirectory();
      if (!picked) {
        return;
      }
      await window.skillsManager.selectProject(picked);
      const nextProjectScan = await window.skillsManager.scanProject();
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
    if (!window.skillsManager) {
      return;
    }

    setBusy(true);
    try {
      await window.skillsManager.clearCurrentProjectSelection();
      setProjectScan(null);
      setPreviewState(null);
      onSuccess("已返回全局 Skills 管理。");
    } catch (error) {
      onError(error instanceof Error ? error.message : "清空项目失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleScanProject() {
    if (!window.skillsManager) {
      return;
    }

    setBusy(true);
    try {
      const nextProjectScan = await window.skillsManager.scanProject();
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
    if (!window.skillsManager) {
      return;
    }

    setBusy(true);
    try {
      const preview = await window.skillsManager.createPreview(action, selectedSkillIds);
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
    if (!window.skillsManager || !selectedProjectHost) {
      return;
    }

    setBusy(true);
    try {
      const preview = await window.skillsManager.createProjectPreview(
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
    if (!window.skillsManager || !previewState) {
      return;
    }

    setBusy(true);
    try {
      const result = previewState.kind === "environment"
        ? await window.skillsManager.executeBatch(previewState.action, previewState.data.items.map((item) => item.skillId))
        : await window.skillsManager.executeProjectBatch(
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
    if (!window.skillsManager) {
      return;
    }

    setBusy(true);
    try {
      const result = await window.skillsManager.rollbackLastBatch();
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
            <button type="button" className="secondary-button small" onClick={() => void reloadAll()} disabled={busy}>
              重新扫描
            </button>
          </div>

          <label className="field-label">
            <span>关键词</span>
            <input
              type="text"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="名称、摘要、路径、用户标签"
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
              onChange={(event) => setFilters((current) => ({ ...current, onlyTagged: event.target.checked }))}
            />
            <span>仅看带用户标签项</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.includeReadonlyOnly}
              onChange={(event) => setFilters((current) => ({ ...current, includeReadonlyOnly: event.target.checked }))}
            />
            <span>仅看只读项</span>
          </label>

          <label className="field-label">
            <span>用户标签</span>
            <select
              value={filters.selectedTag}
              onChange={(event) => setFilters((current) => ({ ...current, selectedTag: event.target.value }))}
            >
              <option value="">全部用户标签</option>
              {viewState.availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <div className="skills-project-box">
            <div className="skills-panel-header">
              <h3>项目态</h3>
              {viewState.project.hasProject && <span className="project-pill">已启用</span>}
            </div>
            <p className="muted">
              {viewState.project.hasProject
                ? `${viewState.project.currentProjectName} · ${viewState.project.currentProjectPath}`
                : "当前未选择项目，项目技能预览与执行按钮会保持禁用。"}
            </p>
            <div className="skills-action-row">
              <button type="button" className="secondary-button small" onClick={handlePickProject} disabled={busy}>
                选择项目
              </button>
              <button type="button" className="secondary-button small" onClick={handleScanProject} disabled={busy || !viewState.project.hasProject}>
                扫描项目
              </button>
              <button type="button" className="secondary-button small" onClick={handleClearProject} disabled={busy || !viewState.project.hasProject}>
                返回全局
              </button>
            </div>
          </div>
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
                onClick={() => setSelectedSkillIds(visibleRecords.map((item) => item.skillId))}
                disabled={busy || visibleRecords.length === 0}
              >
                全选当前列表
              </button>
              <button
                type="button"
                className="secondary-button small"
                onClick={() => setSelectedSkillIds([])}
                disabled={busy || selectedSkillIds.length === 0}
              >
                清空选择
              </button>
            </div>
          </div>

          <div className="skills-list-body">
            {visibleRecords.map((item) => (
              <button
                key={item.skillId}
                type="button"
                className={`skills-row ${detailRow?.skillId === item.skillId ? "active" : ""}`}
                onClick={() => setDetailSkillId(item.skillId)}
              >
                <input
                  type="checkbox"
                  checked={selectedSkillIds.includes(item.skillId)}
                  onChange={() => toggleSelectedSkill(item.skillId)}
                  onClick={(event) => event.stopPropagation()}
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
            ))}

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

          <div className="skills-detail-section">
            <h3>环境操作</h3>
            <div className="skills-action-grid">
              <button type="button" onClick={() => handleEnvironmentPreview("enable")} disabled={busy || selectedSkillIds.length === 0}>
                预览启用
              </button>
              <button type="button" onClick={() => handleEnvironmentPreview("disable")} disabled={busy || selectedSkillIds.length === 0}>
                预览停用
              </button>
              <button
                type="button"
                className="launch-btn primary"
                onClick={handleExecutePreview}
                disabled={busy || previewState?.kind !== "environment"}
              >
                执行环境预览
              </button>
              <button type="button" className="secondary-button" onClick={handleRollback} disabled={busy}>
                回滚上一次批次
              </button>
            </div>
            <p className="helper-copy">
              环境操作会自动跳过只读项和冲突项；真实移动前必须先生成预览。
            </p>
          </div>

          <div className="skills-detail-section">
            <h3>项目操作</h3>
            <div className="skills-action-grid">
              <button
                type="button"
                onClick={() => handleProjectPreview("copy-to-project")}
                disabled={busy || !viewState.project.hasProject || selectedSkillIds.length === 0 || !selectedProjectHost}
              >
                预览加入项目
              </button>
              <button
                type="button"
                onClick={() => handleProjectPreview("remove-from-project")}
                disabled={busy || !viewState.project.hasProject || selectedSkillIds.length === 0 || !selectedProjectHost}
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
