// ProfileItem 列表项组件

import { memo } from "react";
import type { CheckinAttentionEntry } from "../../shared/checkin/presentation.js";

interface ProfileItemProps {
  name: string;
  provider: string;
  isSelected: boolean;
  balanceLabel?: string;
  balanceStatus?: string;
  healthLabel?: string;
  healthStatus?: string;
  healthTitle?: string;
  checkinEntry?: CheckinAttentionEntry;
  pinned?: boolean;
  onSelect: () => void;
}

export const ProfileItem = memo(function ProfileItem({
  name,
  provider: _provider,
  isSelected,
  balanceLabel,
  balanceStatus,
  healthLabel,
  healthStatus,
  healthTitle,
  checkinEntry,
  pinned = false,
  onSelect,
}: ProfileItemProps) {
  return (
    <button
      type="button"
      className={`profile-item ${isSelected ? "selected" : ""}${checkinEntry ? " has-checkin-attention" : ""}`}
      onClick={onSelect}
    >
      <span className="profile-item-drag">{pinned ? "CLI" : "::"}</span>
      <span className="profile-item-name">{name}</span>
      {healthLabel && (
        <span
          className={`profile-item-health ${healthStatus ?? ""}`}
          title={healthTitle}
        >
          {healthLabel}
        </span>
      )}
      {balanceLabel && (
        <span className={`profile-item-balance ${balanceStatus ?? ""}`}>
          {balanceLabel}
        </span>
      )}
      {checkinEntry && (
        <span className="profile-item-checkin-line">
          <span className={`profile-item-checkin ${checkinEntry.variant}`} title={checkinEntry.title}>
            <span aria-hidden="true">⚠</span> {checkinEntry.label}
          </span>
        </span>
      )}
    </button>
  );
});
