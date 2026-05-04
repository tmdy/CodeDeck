// ModelMappingPanel 模型映射配置表

import { useState } from "react";
import type { ModelMappingEntry } from "../../shared/model-mapping/types.js";
import { GlassCard } from "../common/GlassCard.jsx";

interface ModelMappingPanelProps {
  mappings: ModelMappingEntry[];
  onAdd: (entry: Omit<ModelMappingEntry, "id">) => void;
  onUpdate: (id: string, update: Partial<ModelMappingEntry>) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function ModelMappingPanel({
  mappings,
  onAdd,
  onUpdate,
  onDelete,
  disabled,
}: ModelMappingPanelProps) {
  const [newPattern, setNewPattern] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newProvider, setNewProvider] = useState<"claude" | "codex">("claude");

  function handleAdd() {
    if (!newPattern.trim() || !newTarget.trim()) return;
    onAdd({
      provider: newProvider,
      pattern: newPattern.trim(),
      target_model: newTarget.trim(),
      display_name: newDisplay.trim() || newPattern.trim(),
      enabled: true,
      priority: mappings.length + 1,
    });
    setNewPattern("");
    setNewTarget("");
    setNewDisplay("");
  }

  return (
    <GlassCard title="模型映射">
      <p className="muted">
        将简短的模型别名映射到真实的 CLI 模型名称。支持 * 和 ? 通配符。
      </p>

      <div className="model-mapping-table">
        <div className="mm-row mm-header">
          <span>Provider</span>
          <span>模式</span>
          <span>目标模型</span>
          <span>显示名称</span>
          <span>启用</span>
          <span>操作</span>
        </div>
        {mappings.map((m) => (
          <div key={m.id} className="mm-row">
            <span>{m.provider}</span>
            <span>
              <input
                value={m.pattern}
                onChange={(e) => onUpdate(m.id, { pattern: e.target.value })}
                disabled={disabled}
              />
            </span>
            <span>
              <input
                value={m.target_model}
                onChange={(e) => onUpdate(m.id, { target_model: e.target.value })}
                disabled={disabled}
              />
            </span>
            <span>{m.display_name}</span>
            <span>
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) => onUpdate(m.id, { enabled: e.target.checked })}
                disabled={disabled}
              />
            </span>
            <span>
              <button
                type="button"
                className="secondary-button small"
                onClick={() => onDelete(m.id)}
                disabled={disabled}
              >
                删除
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="mm-add-row">
        <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as typeof newProvider)} disabled={disabled}>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="模式 (如 sonnet)"
          disabled={disabled}
        />
        <input
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          placeholder="目标模型 (如 claude-sonnet-4)"
          disabled={disabled}
        />
        <input
          value={newDisplay}
          onChange={(e) => setNewDisplay(e.target.value)}
          placeholder="显示名称"
          disabled={disabled}
        />
        <button type="button" onClick={handleAdd} disabled={disabled || !newPattern.trim() || !newTarget.trim()}>
          添加
        </button>
      </div>
    </GlassCard>
  );
}