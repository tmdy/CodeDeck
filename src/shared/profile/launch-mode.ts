// 启动模式 — 翻译自 Go internal/domain/launch/launch_mode.go

export type LaunchMode =
  | "new"
  | "continue_last"
  | "resume_selected"
  | "resume_picker"
  | "resume_picker_all";

export const MODE_NEW = "new" as const;
export const MODE_CONTINUE_LAST = "continue_last" as const;
export const MODE_RESUME_SELECTED = "resume_selected" as const;
export const MODE_RESUME_PICKER = "resume_picker" as const;
export const MODE_RESUME_PICKER_ALL = "resume_picker_all" as const;

export function normalizeLaunchMode(mode: string): LaunchMode {
  switch (mode.trim()) {
    case "continue":
    case MODE_CONTINUE_LAST:
      return MODE_CONTINUE_LAST;
    case MODE_RESUME_SELECTED:
      return MODE_RESUME_SELECTED;
    case MODE_RESUME_PICKER:
      return MODE_RESUME_PICKER;
    case MODE_RESUME_PICKER_ALL:
      return MODE_RESUME_PICKER_ALL;
    case "direct":
    case MODE_NEW:
      return MODE_NEW;
    default:
      return MODE_NEW;
  }
}
