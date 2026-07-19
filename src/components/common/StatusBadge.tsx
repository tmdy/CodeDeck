// StatusBadge 状态徽章组件

interface StatusBadgeProps {
  label: string;
  variant: "success" | "danger" | "warning" | "info" | "muted";
}

export function StatusBadge({ label, variant }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${variant}`}>{label}</span>;
}