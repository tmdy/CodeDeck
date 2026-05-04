// 启动模式 — 翻译自 Go internal/domain/launch/launch_mode.go

export type LaunchMode = "direct" | "continue" | "resume_selected";

export const MODE_DIRECT = "direct" as const;
export const MODE_CONTINUE = "continue" as const;
export const MODE_RESUME_SELECTED = "resume_selected" as const;

export function normalizeLaunchMode(mode: string): LaunchMode {
  switch (mode.trim()) {
    case MODE_CONTINUE:
      return MODE_CONTINUE;
    case MODE_RESUME_SELECTED:
      return MODE_RESUME_SELECTED;
    default:
      return MODE_DIRECT;
  }
}