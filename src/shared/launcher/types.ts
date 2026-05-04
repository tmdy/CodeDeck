// 启动器类型 — 翻译自 Go internal/domain/launch/

import type { ProfileKey, RuntimeSettings } from "../profile/types.js";

export interface LaunchRequest {
  profile_key: ProfileKey;
  provider: string;
  runtime_settings: RuntimeSettings;
  session_id?: string;
}

export interface CommandPreview {
  command: string;
  valid: boolean;
}