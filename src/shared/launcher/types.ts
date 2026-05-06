// 启动器类型 — 翻译自 Go internal/domain/launch/

import type { PermissionPreset } from "../profile/permissions.js";
import type { ProfileKey, RuntimeSettings } from "../profile/types.js";
import type { ModelMappingsState } from "../model-mapping/config-types.js";

export interface LaunchRequest {
  profile_key: ProfileKey;
  provider: string;
  runtime_settings: RuntimeSettings;
  session_id?: string;
  model_mappings_state?: ModelMappingsState;
  permission_override?: PermissionPreset;
}

export interface PreviewEnvVar {
  name: string;
  present: boolean;
  displayValue: string;
  sensitive: boolean;
}

export interface CommandPreview {
  command: string;
  cwd: string;
  env: PreviewEnvVar[];
  valid: boolean;
  error?: string;
  permissionSummary?: string;
}
