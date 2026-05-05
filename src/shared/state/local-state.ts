// 本地状态模型 — 翻译自 Go internal/domain/state/local_state.go
// 扩展了模型映射和参数设置字段

import type { ProfileKey } from "../profile/types.js";
import type { RuntimeSettings, GlobalSettings } from "../profile/types.js";
import { DEFAULT_PROVIDER, normalizeProvider, defaultGlobalSettings } from "../profile/types.js";
import type { ConnectivityTestState } from "../connectivity/types.js";
import type { BalanceCheckState } from "../balance/types.js";
import type { ParameterSettings } from "../parameter/types.js";
import { defaultParameterSettings, normalizeParameterSettings } from "../parameter/types.js";
import type { SessionListScope } from "../services/session-service.js";

export interface LocalState {
  selected_provider: string;
  selected_profile_key: ProfileKey;
  selected_profile_key_by_provider: Record<string, ProfileKey>;
  profile_order_by_provider: Record<string, ProfileKey[]>;
  runtime_by_profile: Record<ProfileKey, RuntimeSettings>;
  connectivity_tests_by_profile: Record<ProfileKey, ConnectivityTestState>;
  balance_checks_by_profile: Record<ProfileKey, BalanceCheckState>;
  global_settings: GlobalSettings;
  /** 遗留的全局模型映射配置，仅为兼容旧状态读取 */
  model_mappings?: unknown[];
  /** 参数设置 */
  parameter_settings: ParameterSettings;
  /** 会话页每个 provider 当前选中的范围 */
  sessions_tab_scope_by_provider: Record<string, SessionListScope>;
  /** 会话页每个 provider 最近一次用于恢复的 profile */
  sessions_tab_restore_profile_key_by_provider: Record<string, ProfileKey>;
}

export function defaultLocalState(): LocalState {
  return {
    selected_provider: DEFAULT_PROVIDER,
    selected_profile_key: "",
    selected_profile_key_by_provider: {},
    profile_order_by_provider: {},
    runtime_by_profile: {},
    connectivity_tests_by_profile: {},
    balance_checks_by_profile: {},
    global_settings: defaultGlobalSettings(),
    parameter_settings: defaultParameterSettings(),
    sessions_tab_scope_by_provider: {},
    sessions_tab_restore_profile_key_by_provider: {},
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
  state.balance_checks_by_profile ??= {};
  state.global_settings ??= defaultGlobalSettings();
  state.parameter_settings = normalizeParameterSettings(
    state.parameter_settings ?? defaultParameterSettings(),
  );
  state.sessions_tab_scope_by_provider ??= {};
  state.sessions_tab_restore_profile_key_by_provider ??= {};

  return state;
}
