// ProfileItem 列表项组件

import { memo } from "react";

interface ProfileItemProps {
  name: string;
  provider: string;
  isSelected: boolean;
  balanceLabel?: string;
  balanceStatus?: string;
  pinned?: boolean;
  onSelect: () => void;
}

export const ProfileItem = memo(function ProfileItem({
  name,
  provider: _provider,
  isSelected,
  balanceLabel,
  balanceStatus,
  pinned = false,
  onSelect,
}: ProfileItemProps) {
  return (
    <button
      type="button"
      className={`profile-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="profile-item-drag">{pinned ? "CLI" : "::"}</span>
      <span className="profile-item-name">{name}</span>
      {balanceLabel && (
        <span className={`profile-item-balance ${balanceStatus ?? ""}`}>
          {balanceLabel}
        </span>
      )}
    </button>
  );
});
