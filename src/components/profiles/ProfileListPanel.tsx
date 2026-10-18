import {
  memo,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import type { BalanceListEntry } from "../../shared/balance/presentation.js";
import type { CheckinAttentionEntry } from "../../shared/checkin/presentation.js";
import type { ProfileHealthListEntry } from "../../shared/profile-health/presentation.js";
import { itemKey } from "../../shared/profile/keys-internal.js";
import {
  cloneProfileOrganization,
  flattenProfileOrganization,
  moveProfileGroup,
  moveProfileInOrganization,
  normalizeProfileOrganization,
  type ProfileOrganization,
} from "../../shared/profile/organization.js";
import {
  isOfficialNativeProfile,
  type Profile,
  type ProfileKey,
  type ProviderID,
} from "../../shared/profile/types.js";
import { ProfileItem } from "./ProfileItem.jsx";

interface ProfileListPanelProps {
  profiles: Profile[];
  activeProvider: ProviderID;
  selectedKey: ProfileKey;
  orderedKeys: ProfileKey[];
  organization?: ProfileOrganization;
  balanceEntries: Record<ProfileKey, BalanceListEntry>;
  healthEntries?: Record<ProfileKey, ProfileHealthListEntry>;
  checkinEntries?: Record<ProfileKey, CheckinAttentionEntry>;
  onSelect: (key: ProfileKey) => void;
  onReorder: (orderedKeys: ProfileKey[]) => void;
  onOrganizationChange?: (organization: ProfileOrganization) => void | Promise<void>;
  onCreate: () => void;
  onClone: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

type DragState =
  | { type: "profile"; key: ProfileKey }
  | { type: "group"; groupId: string };

type GroupEditorState =
  | { mode: "create"; value: string }
  | { mode: "rename"; groupId: string; value: string }
  | null;

interface VisibleProfileItem {
  key: ProfileKey;
  name: string;
  provider: string;
}

export const ProfileListPanel = memo(function ProfileListPanel({
  profiles,
  activeProvider,
  selectedKey,
  orderedKeys,
  organization,
  balanceEntries,
  healthEntries = {},
  checkinEntries = {},
  onSelect,
  onReorder,
  onOrganizationChange,
  onCreate,
  onClone,
  onDelete,
  disabled,
}: ProfileListPanelProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState("");
  const [groupEditor, setGroupEditor] = useState<GroupEditorState>(null);
  const [groupEditorError, setGroupEditorError] = useState("");
  const [menuGroupId, setMenuGroupId] = useState("");

  const providerProfiles = useMemo(
    () => profiles.filter((profile) => profile.provider === activeProvider),
    [activeProvider, profiles],
  );
  const officialProfile = providerProfiles.find(isOfficialNativeProfile);
  const userProfiles = providerProfiles.filter((profile) => !isOfficialNativeProfile(profile));
  const profileByKey = useMemo(
    () => new Map(userProfiles.map((profile) => [itemKey(profile), profile] as const)),
    [userProfiles],
  );
  const fallbackKeys = useMemo(() => {
    const validKeys = new Set(profileByKey.keys());
    return [
      ...orderedKeys.filter((key) => validKeys.has(key)),
      ...userProfiles.map(itemKey),
    ];
  }, [orderedKeys, profileByKey, userProfiles]);
  const effectiveOrganization = useMemo(
    () => normalizeProfileOrganization(organization, activeProvider, fallbackKeys),
    [activeProvider, fallbackKeys, organization],
  );
  const selectedIsOfficial = officialProfile
    ? itemKey(officialProfile) === selectedKey
    : false;

  function visibleItems(keys: ProfileKey[]): VisibleProfileItem[] {
    return keys.flatMap((key) => {
      const profile = profileByKey.get(key);
      return profile ? [{ key, name: profile.name, provider: profile.provider }] : [];
    });
  }

  function commitOrganization(next: ProfileOrganization): void {
    if (onOrganizationChange) {
      void onOrganizationChange(next);
      return;
    }
    onReorder(flattenProfileOrganization(next));
  }

  function beginProfileDrag(event: DragEvent, key: ProfileKey): void {
    setDragState({ type: "profile", key });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
  }

  function beginGroupDrag(event: DragEvent, groupId: string): void {
    event.stopPropagation();
    setDragState({ type: "group", groupId });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
  }

  function allowDrop(event: DragEvent, target: string, type: DragState["type"]): void {
    if (dragState?.type !== type) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  }

  function dropProfile(
    event: DragEvent,
    targetGroupId: string | null,
    targetIndex: number,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (dragState?.type !== "profile") {
      return;
    }
    const next = moveProfileInOrganization(
      effectiveOrganization,
      dragState.key,
      targetGroupId,
      targetIndex,
    );
    commitOrganization(next);
    finishDrag();
  }

  function dropGroup(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (dragState?.type !== "group") {
      return;
    }
    const next = moveProfileGroup(
      effectiveOrganization,
      dragState.groupId,
      targetIndex,
    );
    commitOrganization(next);
    finishDrag();
  }

  function groupHeadingTargetIndex(event: DragEvent, groupIndex: number): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY >= bounds.top + bounds.height / 2
      ? groupIndex + 1
      : groupIndex;
  }

  function allowGroupHeadingDrop(
    event: DragEvent,
    groupIndex: number,
    profileTarget: string,
  ): void {
    if (dragState?.type === "group") {
      const targetIndex = groupHeadingTargetIndex(event, groupIndex);
      allowDrop(event, `group:${targetIndex}`, "group");
      return;
    }
    allowDrop(event, profileTarget, "profile");
  }

  function dropOnGroupHeading(
    event: DragEvent,
    groupIndex: number,
    groupId: string,
    profileCount: number,
  ): void {
    if (dragState?.type === "group") {
      dropGroup(event, groupHeadingTargetIndex(event, groupIndex));
      return;
    }
    dropProfile(event, groupId, profileCount);
  }

  function finishDrag(): void {
    setDragState(null);
    setDropTarget("");
  }

  function toggleSection(groupId: string | null): void {
    const next = cloneProfileOrganization(effectiveOrganization);
    if (groupId === null) {
      next.ungrouped_collapsed = !next.ungrouped_collapsed;
    } else {
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      group.collapsed = !group.collapsed;
    }
    commitOrganization(next);
  }

  function openCreateGroup(): void {
    setMenuGroupId("");
    setGroupEditorError("");
    setGroupEditor({ mode: "create", value: "" });
  }

  function openRenameGroup(groupId: string): void {
    const group = effectiveOrganization.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setMenuGroupId("");
    setGroupEditorError("");
    setGroupEditor({ mode: "rename", groupId, value: group.name });
  }

  function saveGroupEditor(event: FormEvent): void {
    event.preventDefault();
    if (!groupEditor) return;
    const name = groupEditor.value.trim();
    if (!name) {
      setGroupEditorError("组名不能为空");
      return;
    }
    const duplicate = effectiveOrganization.groups.some((group) => (
      group.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      && (groupEditor.mode === "create" || group.id !== groupEditor.groupId)
    ));
    if (duplicate) {
      setGroupEditorError("组名已存在");
      return;
    }
    const next = cloneProfileOrganization(effectiveOrganization);
    if (groupEditor.mode === "create") {
      next.groups.push({
        id: createGroupId(),
        name,
        profile_keys: [],
        collapsed: false,
      });
    } else {
      const group = next.groups.find((candidate) => candidate.id === groupEditor.groupId);
      if (!group) return;
      group.name = name;
    }
    commitOrganization(next);
    setGroupEditor(null);
    setGroupEditorError("");
  }

  function deleteGroup(groupId: string): void {
    const group = effectiveOrganization.groups.find((candidate) => candidate.id === groupId);
    if (!group || !window.confirm(`删除组“${group.name}”？组内 Profile 将移到未分组。`)) {
      return;
    }
    const next = cloneProfileOrganization(effectiveOrganization);
    const index = next.groups.findIndex((candidate) => candidate.id === groupId);
    if (index < 0) return;
    const [removed] = next.groups.splice(index, 1);
    next.ungrouped_profile_keys.push(...removed.profile_keys);
    commitOrganization(next);
    setMenuGroupId("");
    if (groupEditor?.mode === "rename" && groupEditor.groupId === groupId) {
      setGroupEditor(null);
    }
  }

  function renderProfile(item: VisibleProfileItem, groupId: string | null, index: number) {
    const target = `profile:${groupId ?? "ungrouped"}:${index}`;
    return (
      <div
        key={item.key}
        className={`profile-item-drop ${dropTarget === target ? "drop-before" : ""}`}
        draggable={!disabled}
        onDragStart={(event) => beginProfileDrag(event, item.key)}
        onDragEnd={finishDrag}
        onDragOver={(event) => allowDrop(event, target, "profile")}
        onDrop={(event) => dropProfile(event, groupId, index)}
      >
        <ProfileItem
          name={item.name}
          provider={item.provider}
          isSelected={item.key === selectedKey}
          balanceLabel={balanceEntries[item.key]?.label ?? ""}
          balanceStatus={balanceEntries[item.key]?.status ?? ""}
          healthLabel={healthEntries[item.key]?.label ?? ""}
          healthStatus={healthEntries[item.key]?.status ?? ""}
          healthTitle={healthEntries[item.key]?.title ?? ""}
          checkinEntry={checkinEntries[item.key]}
          onSelect={() => onSelect(item.key)}
        />
      </div>
    );
  }

  function renderSectionContent(keys: ProfileKey[], groupId: string | null, collapsed: boolean) {
    if (collapsed) return null;
    const items = visibleItems(keys);
    const endTarget = `profile:${groupId ?? "ungrouped"}:end`;
    return (
      <div className="profile-group-items">
        {items.map((item, index) => renderProfile(item, groupId, index))}
        <div
          className={`profile-drop-end ${dropTarget === endTarget ? "active" : ""}`}
          onDragOver={(event) => allowDrop(event, endTarget, "profile")}
          onDrop={(event) => dropProfile(event, groupId, items.length)}
        >
          {items.length === 0 ? "拖动 Profile 到这里" : null}
        </div>
      </div>
    );
  }

  return (
    <div className="profile-list-panel glass-card">
      <div className="profile-list-header">
        <h3>Profiles</h3>
        <div className="profile-list-actions">
          <button type="button" onClick={openCreateGroup} disabled={disabled} title="新建组">
            +组
          </button>
          <button type="button" onClick={onCreate} disabled={disabled} title="新建 Profile">
            +
          </button>
          <button type="button" onClick={onClone} disabled={disabled || !selectedKey || selectedIsOfficial} title="克隆到另一 Provider">
            &#8644;
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={disabled || !selectedKey || selectedIsOfficial} title="删除 Profile">
            &#128465;
          </button>
        </div>
      </div>

      {groupEditor?.mode === "create" && (
        <GroupEditor
          value={groupEditor.value}
          error={groupEditorError}
          submitLabel="创建"
          onChange={(value) => setGroupEditor({ mode: "create", value })}
          onSubmit={saveGroupEditor}
          onCancel={() => setGroupEditor(null)}
        />
      )}

      <div className="profile-list">
        {officialProfile && (
          <ProfileItem
            name={officialProfile.name}
            provider={officialProfile.provider}
            isSelected={itemKey(officialProfile) === selectedKey}
            pinned
            onSelect={() => onSelect(itemKey(officialProfile))}
          />
        )}

        <section className={`profile-group profile-group-ungrouped ${
          effectiveOrganization.ungrouped_profile_keys.includes(selectedKey)
            ? "contains-selected"
            : ""
        }`}>
          <button
            type="button"
            className={`profile-group-heading ${
              dropTarget === "profile:ungrouped:header" ? "drop-inside" : ""
            }`}
            onClick={() => toggleSection(null)}
            onDragOver={(event) => allowDrop(event, "profile:ungrouped:header", "profile")}
            onDrop={(event) => dropProfile(
              event,
              null,
              effectiveOrganization.ungrouped_profile_keys.length,
            )}
            aria-expanded={!effectiveOrganization.ungrouped_collapsed}
          >
            <span className="profile-group-chevron" aria-hidden="true">
              {effectiveOrganization.ungrouped_collapsed ? "\u25b8" : "\u25be"}
            </span>
            <span className="profile-group-name">未分组</span>
            <span className="profile-group-count">{effectiveOrganization.ungrouped_profile_keys.length}</span>
          </button>
          {renderSectionContent(
            effectiveOrganization.ungrouped_profile_keys,
            null,
            effectiveOrganization.ungrouped_collapsed,
          )}
        </section>

        {effectiveOrganization.groups.map((group, groupIndex) => {
          const groupDropTarget = `group:${groupIndex}`;
          const containsSelected = group.profile_keys.includes(selectedKey);
          return (
            <div key={group.id}>
              <div
                className={`profile-group-drop ${dropTarget === groupDropTarget ? "active" : ""}`}
                onDragOver={(event) => allowDrop(event, groupDropTarget, "group")}
                onDrop={(event) => dropGroup(event, groupIndex)}
              />
              <section className={`profile-group ${containsSelected ? "contains-selected" : ""}`}>
                <div
                  className={`profile-group-heading ${
                    dropTarget === `profile:${group.id}:header` ? "drop-inside" : ""
                  } ${dropTarget === `group:${groupIndex}` ? "group-drop-before" : ""} ${
                    dropTarget === `group:${groupIndex + 1}` ? "group-drop-after" : ""
                  }`}
                  onDragOver={(event) => allowGroupHeadingDrop(
                    event,
                    groupIndex,
                    `profile:${group.id}:header`,
                  )}
                  onDrop={(event) => dropOnGroupHeading(
                    event,
                    groupIndex,
                    group.id,
                    group.profile_keys.length,
                  )}
                >
                  <span
                    className="profile-group-drag"
                    draggable={!disabled}
                    onDragStart={(event) => beginGroupDrag(event, group.id)}
                    onDragEnd={finishDrag}
                    title="按住上下拖动组"
                    aria-label={`上下拖动组 ${group.name}`}
                  >
                    &#8597;
                  </span>
                  <button
                    type="button"
                    className="profile-group-toggle"
                    onClick={() => toggleSection(group.id)}
                    aria-expanded={!group.collapsed}
                    title={group.collapsed ? "展开组" : "折叠组"}
                  >
                    <span className="profile-group-chevron" aria-hidden="true">
                      {group.collapsed ? "\u25b8" : "\u25be"}
                    </span>
                    <span className="profile-group-name">{group.name}</span>
                    <span className="profile-group-count">{group.profile_keys.length}</span>
                  </button>
                  <div
                    className="profile-group-menu"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setMenuGroupId("");
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="profile-group-menu-trigger"
                      onClick={() => setMenuGroupId(menuGroupId === group.id ? "" : group.id)}
                      disabled={disabled}
                      title="组管理"
                      aria-label={`管理组 ${group.name}`}
                      aria-expanded={menuGroupId === group.id}
                    >
                      ...
                    </button>
                    {menuGroupId === group.id && (
                      <div className="profile-group-menu-popover">
                        <button type="button" onClick={() => openRenameGroup(group.id)}>重命名</button>
                        <button type="button" className="danger" onClick={() => deleteGroup(group.id)}>删除组</button>
                      </div>
                    )}
                  </div>
                </div>
                {groupEditor?.mode === "rename" && groupEditor.groupId === group.id && (
                  <GroupEditor
                    value={groupEditor.value}
                    error={groupEditorError}
                    submitLabel="保存"
                    onChange={(value) => setGroupEditor({ mode: "rename", groupId: group.id, value })}
                    onSubmit={saveGroupEditor}
                    onCancel={() => setGroupEditor(null)}
                  />
                )}
                {renderSectionContent(group.profile_keys, group.id, group.collapsed)}
              </section>
            </div>
          );
        })}

        <div
          className={`profile-group-drop profile-group-drop-end ${dropTarget === "group:end" ? "active" : ""}`}
          onDragOver={(event) => allowDrop(event, "group:end", "group")}
          onDrop={(event) => dropGroup(event, effectiveOrganization.groups.length)}
        />

        {!officialProfile && userProfiles.length === 0 && (
          <p className="empty-state">暂无 Profile，点击 + 创建</p>
        )}
      </div>
    </div>
  );
});

function GroupEditor({
  value,
  error,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  error: string;
  submitLabel: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="profile-group-editor" onSubmit={onSubmit}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="组名"
        aria-label="组名"
        autoFocus
      />
      <button type="submit">{submitLabel}</button>
      <button type="button" className="secondary" onClick={onCancel}>取消</button>
      {error && <span className="profile-group-editor-error">{error}</span>}
    </form>
  );
}

function createGroupId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
