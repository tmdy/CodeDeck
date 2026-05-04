// ProfileItem 列表项组件

interface ProfileItemProps {
  name: string;
  provider: string;
  isSelected: boolean;
  connectivity?: string; // "success" | "fail" | "pending" | ""
  onSelect: () => void;
}

export function ProfileItem({
  name,
  provider: _provider,
  isSelected,
  connectivity,
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
      {connectivity === "success" && <span className="profile-item-status success">&#10003;</span>}
      {connectivity === "fail" && <span className="profile-item-status fail">!</span>}
      {connectivity === "pending" && <span className="profile-item-status pending">...</span>}
    </button>
  );
}