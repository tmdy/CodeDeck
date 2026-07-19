import { GlassCard } from "../common/GlassCard.jsx";
import {
  CLAUDE_ALIASES,
  CLAUDE_ALIAS_LABELS,
  CODEX_ALIASES,
  CODEX_ALIAS_LABELS,
  type ClaudeAlias,
  type CodexAlias,
  type MappingAlias,
  type MappingClient,
  type ModelMappingsState,
} from "../../shared/model-mapping/config-types.js";

interface ModelMappingPanelProps {
  state: ModelMappingsState;
  client: MappingClient;
  currentSiteLabel: string;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
  success?: string | null;
  onClientChange: (client: MappingClient) => void;
  onSelectedAliasChange: (alias: ClaudeAlias | CodexAlias) => void;
  onMappingChange: (
    alias: MappingAlias,
    changes: Partial<{
      targetModel: string;
      enabled: boolean;
      fallbackToDefault: boolean;
    }>,
  ) => void;
  onSave: () => void;
  onFetchModels: (client: MappingClient) => void;
}

function getAliasLabel(client: MappingClient, alias: MappingAlias): string {
  return client === "claude"
    ? CLAUDE_ALIAS_LABELS[alias as ClaudeAlias]
    : CODEX_ALIAS_LABELS[alias as CodexAlias];
}

export function ModelMappingPanel({
  state,
  client,
  currentSiteLabel,
  disabled,
  busy,
  error,
  success,
  onClientChange,
  onSelectedAliasChange,
  onMappingChange,
  onSave,
  onFetchModels,
}: ModelMappingPanelProps) {
  const aliases = client === "claude" ? CLAUDE_ALIASES : CODEX_ALIASES;
  const selectedAlias = client === "claude" ? state.selectedClaudeAlias : state.selectedCodexAlias;
  const fetchedModels = state.fetchedModelsByClient[client] ?? [];
  const fetchedAt = state.lastFetchedAtByClient[client];

  return (
    <GlassCard title="模型映射" subtitle={client === "claude" ? "Claude Code" : "Codex / CC"}>
      <div className="model-mapping-toolbar">
        <label>
          客户端
          <select value={client} onChange={(e) => onClientChange(e.target.value as MappingClient)} disabled={disabled}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex / CC</option>
          </select>
        </label>
        <label>
          当前启动槽位
          <select
            value={selectedAlias}
            onChange={(e) => onSelectedAliasChange(e.target.value as ClaudeAlias | CodexAlias)}
            disabled={disabled}
          >
            {aliases.map((alias) => (
              <option key={alias} value={alias}>
                {getAliasLabel(client, alias)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={onSave} disabled={disabled || busy}>
          {busy ? "保存中..." : "保存映射"}
        </button>
      </div>

      <p className="muted">当前站点：{currentSiteLabel}。不需要额外 provider；映射直接作用于这个站点返回的模型列表。</p>
      <div className="inline-actions">
        <button type="button" className="secondary-button" onClick={() => onFetchModels(client)} disabled={disabled || busy}>
          {busy ? "获取中..." : "从当前站点获取模型"}
        </button>
      </div>
      {fetchedAt && <p className="muted">最近获取：{fetchedAt}</p>}
      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner success">{success}</div>}

      <div className="mapping-grid">
        {aliases.map((alias) => {
          const mapping = state.mappings.find((item) => item.client === client && item.alias === alias);
          if (!mapping) {
            return null;
          }
          return (
            <div key={alias} className="model-mapping-row">
              <label>
                槽位
                <input value={getAliasLabel(client, alias)} disabled />
              </label>
              <label>
                目标模型
                <input
                  list={`mapping-model-options-${client}-${alias}`}
                  value={mapping.targetModel}
                  onChange={(e) => onMappingChange(alias, { targetModel: e.target.value })}
                  placeholder="留空表示继续使用站点官方模型"
                  disabled={disabled}
                />
                <datalist id={`mapping-model-options-${client}-${alias}`}>
                  {fetchedModels.map((item) => (
                    <option key={`${client}-${alias}-${item}`} value={item} />
                  ))}
                </datalist>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={mapping.enabled}
                  onChange={(e) => onMappingChange(alias, { enabled: e.target.checked })}
                  disabled={disabled}
                />
                启用
              </label>
              {alias !== "default" && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={mapping.fallbackToDefault}
                    onChange={(e) => onMappingChange(alias, { fallbackToDefault: e.target.checked })}
                    disabled={disabled}
                  />
                  缺失时回退 Default
                </label>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
