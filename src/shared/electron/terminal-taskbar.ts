import type { TerminalActivity, TerminalActivityReason } from "./terminal-activity.js";

export interface TerminalTaskbarAction {
  progress: number | null;
  flash: boolean;
}

export function resolveTerminalTaskbarAction(options: {
  platform: NodeJS.Platform;
  previousActivity: TerminalActivity;
  activity: TerminalActivity;
  reason: TerminalActivityReason;
  focused: boolean;
}): TerminalTaskbarAction {
  if (options.platform !== "win32") {
    return { progress: null, flash: false };
  }
  if (options.activity === "busy") {
    return { progress: 2, flash: false };
  }
  return {
    progress: -1,
    flash: options.previousActivity === "busy"
      && options.reason === "turn_completed"
      && !options.focused,
  };
}
