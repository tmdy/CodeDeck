// ProfileListPanel 列表组件 — 含拖拽排序

import { useRef, useState, type DragEvent } from "react";
import type { ProfileKey, ProviderID } from "../../shared/profile/types.js";
import type { Profile } from "../../shared/profile/types.js";
import { itemKey } from "../../shared/profile/keys-internal.js";
import { ProfileItem } from "./ProfileItem.jsx";

interface ProfileListPanelProps {
  profiles: Profile[];
  activeProvider: ProviderID;
  selectedKey: ProfileKey;
  orderedKeys: ProfileKey[];
  connectivityStates: Record<ProfileKey, string>;
  onSelect: (key: ProfileKey) => void;
  onReorder: (orderedKeys: ProfileKey[]) => void;
  onCreate: () => void;
  onClone: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

export function ProfileListPanel({
  profiles,
  activeProvider,
  selectedKey,
  orderedKeys,
  connectivityStates,
  onSelect,
  onReorder,
  onCreate,
  onClone,
  onDelete,
  disabled,
}: ProfileListPanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function handleDragStart(e: DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent, dropIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      return;
    }

    const newOrder = [...orderedKeys];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    onReorder(newOrder);
    setDragIndex(null);
  }

  const visible: { key: ProfileKey; name: string; provider: string }[] = [];
  const providerProfiles = profiles.filter((profile) => profile.provider === activeProvider);
  const orderedSet = new Set(orderedKeys);
  for (const k of orderedKeys) {
    const profile = providerProfiles.find((p) => itemKey(p) === k);
    if (profile) {
      visible.push({ key: k, name: profile.name, provider: profile.provider });
    }
  }
  for (const profile of providerProfiles) {
    if (!orderedSet.has(itemKey(profile))) {
      visible.push({
        key: itemKey(profile),
        name: profile.name,
        provider: profile.provider,
      });
    }
  }

  return (
    <div className="profile-list-panel glass-card" ref={listRef}>
      <div className="profile-list-header">
        <h3>Profiles</h3>
        <div className="profile-list-actions">
          <button type="button" onClick={onCreate} disabled={disabled} title="新建">
            +
          </button>
          <button type="button" onClick={onClone} disabled={disabled || !selectedKey} title="克隆到另一 Provider">
            &#8644;
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={disabled || !selectedKey} title="删除">
            &#128465;
          </button>
        </div>
      </div>
      <div className="profile-list">
        {visible.map((item, idx) => (
          <div
            key={item.key}
            draggable={!disabled}
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, idx)}
          >
            <ProfileItem
              name={item.name}
              provider={item.provider}
              isSelected={item.key === selectedKey}
              connectivity={connectivityStates[item.key] ?? ""}
              onSelect={() => onSelect(item.key)}
            />
          </div>
        ))}
        {visible.length === 0 && (
          <p className="empty-state">暂无 Profile，点击 + 创建</p>
        )}
      </div>
    </div>
  );
}
