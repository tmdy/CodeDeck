// 启动器类型 — 翻译自 Go internal/domain/launch/

import type { PermissionPreset } from "../profile/permissions.js";
import type { ProfileKey, RuntimeSettings } from "../profile/types.js";
import type { ModelMappingsState } from "../model-mapping/config-types.js";
import type { ClaudeCapabilityOverlay, CodexCapabilityOverlay } from "../services/capability-overlay-service.js";

export interface LaunchRequest {
  profile_key: ProfileKey;
  provider: string;
  runtime_settings: RuntimeSettings;
  terminal_mode?: "direct" | "monitored";
  session_id?: string;
  session_source?: LaunchSessionSource;
  model_mappings_state?: ModelMappingsState;
  permission_override?: PermissionPreset;
  capability_overlay?: LaunchCapabilityOverlay;
}

export interface LaunchSessionSource {
  source_kind?: "app_runtime" | "global_codex";
  source_home?: string;
}

export interface LaunchCapabilityOverlay {
  claude?: ClaudeCapabilityOverlay;
  codex?: CodexCapabilityOverlay;
}

export interface LaunchResult {
  launched: boolean;
  terminalMode: "direct" | "monitored";
  monitoringActive: boolean;
  terminalSessionId?: string;
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
  capabilitySummary?: string;
  terminalSummary?: string;
}
