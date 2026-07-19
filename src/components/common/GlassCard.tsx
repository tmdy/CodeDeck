// GlassCard 通用毛玻璃卡片组件

import type { ReactNode } from "react";

interface GlassCardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function GlassCard({ title, subtitle, children, className = "" }: GlassCardProps) {
  return (
    <div className={`glass-card ${className}`}>
      {title && (
        <div className="glass-card-header">
          <h3>{title}</h3>
          {subtitle && <span className="glass-card-subtitle">{subtitle}</span>}
        </div>
      )}
      <div className="glass-card-body">{children}</div>
    </div>
  );
}