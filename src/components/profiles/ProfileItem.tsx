// ProfileItem 列表项组件

interface ProfileItemProps {
  name: string;
  provider: string;
  isSelected: boolean;
  connectivity?: string; // "success" | "fail" | "pending" | ""
  balanceLabel?: string;
  balanceStatus?: string;
  onSelect: () => void;
}

export function ProfileItem({
  name,
  provider: _provider,
  isSelected,
  connectivity,
  balanceLabel,
  balanceStatus,
  onSelect,
}: ProfileItemProps) {
  return (
    <button
      type="button"
      className={`profile-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="profile-item-drag">::</span>
      <span className="profile-item-name">{name}</span>
      {balanceLabel && (
        <span className={`profile-item-balance ${balanceStatus ?? ""}`}>
          {balanceLabel}
        </span>
      )}
      {connectivity === "success" && <span className="profile-item-status success">&#10003;</span>}
      {connectivity === "fail" && <span className="profile-item-status fail">!</span>}
      {connectivity === "pending" && <span className="profile-item-status pending">...</span>}
    </button>
  );
}
