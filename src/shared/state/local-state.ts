// 本地状态模型 — 翻译自 Go internal/domain/state/local_state.go
// 扩展了模型映射和参数设置字段

import type { ProfileKey } from "../profile/types.js";
import type { RuntimeSettings, GlobalSettings } from "../profile/types.js";
import { DEFAULT_PROVIDER, normalizeProvider, defaultGlobalSettings } from "../profile/types.js";
import type { ConnectivityTestState } from "../connectivity/types.js";
import type { ModelMappingEntry } from "../model-mapping/types.js";
import type { ParameterSettings } from "../parameter/types.js";
import { defaultParameterSettings } from "../parameter/types.js";

export interface LocalState {
  selected_provider: string;
  selected_profile_key: ProfileKey;
  selected_profile_key_by_provider: Record<string, ProfileKey>;
  profile_order_by_provider: Record<string, ProfileKey[]>;
  runtime_by_profile: Record<ProfileKey, RuntimeSettings>;
  connectivity_tests_by_profile: Record<ProfileKey, ConnectivityTestState>;
  global_settings: GlobalSettings;
  /** 模型映射配置 */
  model_mappings: ModelMappingEntry[];
  /** 参数设置 */
  parameter_settings: ParameterSettings;
}

export function defaultLocalState(): LocalState {
  return {
    selected_provider: DEFAULT_PROVIDER,
    selected_profile_key: "",
    selected_profile_key_by_provider: {},
    profile_order_by_provider: {},
    runtime_by_profile: {},
    connectivity_tests_by_profile: {},
    global_settings: defaultGlobalSettings(),
    model_mappings: [],
    parameter_settings: defaultParameterSettings(),
  };
}

/**
 * 确保所有 map 字段已初始化
 */
export function ensureInitialized(state: LocalState): LocalState {
  if (!state.selected_provider) {
    state.selected_provider = DEFAULT_PROVIDER;
  }
  state.selected_provider = normalizeProvider(state.selected_provider);

  state.selected_profile_key_by_provider ??= {};
  state.profile_order_by_provider ??= {};
  state.runtime_by_profile ??= {};
  state.connectivity_tests_by_profile ??= {};
  state.global_settings ??= defaultGlobalSettings();
  state.model_mappings ??= [];
  state.parameter_settings ??= defaultParameterSettings();

  return state;
}