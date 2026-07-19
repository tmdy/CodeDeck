// 本地状态持久化 — 翻译自 Go internal/storage/localstate/store.go
// 与 Go/Python 版本的 local_state.json 格式完全兼容

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileKey, RuntimeSettings, GlobalSettings } from "../profile/types.js";
import {
  normalizeProvider,
  normalizeRuntimeSettings,
  normalizeGlobalSettings,
  DEFAULT_PROVIDER,
} from "../profile/types.js";
import {
  buildKey,
  splitKey,
  normalizeKeyWithFallback,
} from "../profile/keys-internal.js";
import type { BalanceCheckItem, BalanceCheckState } from "../balance/types.js";
import type { ParameterSettings } from "../parameter/types.js";
import { normalizeParameterSettings } from "../parameter/types.js";
import type { LocalState } from "./local-state.js";
import {
  defaultLocalState,
  ensureInitialized,
  normalizeSessionFavorites,
  normalizeWorkingDirectoryFavorites,
} from "./local-state.js";
import { isSessionListScope, type SessionListScope } from "../services/session-service.js";
import { normalizeSessionsTabScope } from "../session-history-state.js";
import { normalizeCheckinStatesByAccount } from "../checkin/types.js";

interface RawState {
  selected_provider: string;
  selected_profile_key: string;
  selected_profile_name?: string;  // 遗留字段
  selected_profile_key_by_provider: Record<string, string>;
  profile_order_by_provider: Record<string, string[]>;
  runtime_by_profile: Record<string, RuntimeSettings>;
  connectivity_tests_by_profile?: unknown;
  balance_checks_by_profile: Record<string, BalanceCheckState>;
  checkin_states_by_account?: unknown;
  checkin_next_scheduled_at?: unknown;
  global_settings: GlobalSettings;
  model_mappings?: unknown[];
  parameter_settings?: ParameterSettings;
  sessions_tab_scope_by_provider: Record<string, SessionListScope>;
  sessions_tab_restore_profile_key_by_provider: Record<string, string>;
  working_directory_favorites?: unknown;
  session_favorites?: unknown;
}

export class LocalStateStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<LocalState> {
    try {
      await fs.access(this.filePath);
    } catch {
      return defaultLocalState();
    }

    let raw: RawState;
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      raw = JSON.parse(data);
    } catch {
      return defaultLocalState();
    }

    return normalizeState(raw);
  }

  async save(state: LocalState): Promise<void> {
    const normalized = ensureInitialized({ ...state });
    const selectedProviderID = normalizeProvider(normalized.selected_provider) || DEFAULT_PROVIDER;

    if (normalized.selected_profile_key) {
      normalized.selected_profile_key_by_provider[selectedProviderID] =
        normalized.selected_profile_key;
    }

    const payload: RawState = {
      selected_provider: selectedProviderID,
      selected_profile_key: normalized.selected_profile_key,
      selected_profile_key_by_provider: {},
      profile_order_by_provider: {},
      runtime_by_profile: {},
      balance_checks_by_profile: {},
      checkin_states_by_account: normalizeCheckinStatesByAccount(
        normalized.checkin_states_by_account,
      ),
      checkin_next_scheduled_at: normalized.checkin_next_scheduled_at,
      global_settings: normalizeGlobalSettings(normalized.global_settings),
      parameter_settings: normalizeParameterSettings(normalized.parameter_settings),
      sessions_tab_scope_by_provider: {},
      sessions_tab_restore_profile_key_by_provider: {},
      working_directory_favorites: normalizeWorkingDirectoryFavorites(
        normalized.working_directory_favorites,
      ),
      session_favorites: normalizeSessionFavorites(normalized.session_favorites),
    };

    // 序列化 selected keys by provider
    for (const [providerID, key] of Object.entries(normalized.selected_profile_key_by_provider)) {
      const nKey = normalizeKeyWithFallback(key, providerID);
      if (nKey) {
        payload.selected_profile_key_by_provider[normalizeProvider(providerID)] = nKey;
      }
    }

    // 序列化 profile order by provider
    for (const [providerID, orderedKeys] of Object.entries(normalized.profile_order_by_provider)) {
      const nProv = normalizeProvider(providerID);
      payload.profile_order_by_provider[nProv] = orderedKeys
        .map((k) => normalizeKeyWithFallback(k, nProv))
        .filter(Boolean);
    }

    // 序列化 runtime by profile
    for (const [key, runtime] of Object.entries(normalized.runtime_by_profile)) {
      const [prov] = splitKey(key);
      const nKey = normalizeKeyWithFallback(key, prov);
      if (nKey) {
        payload.runtime_by_profile[nKey] = normalizeRuntimeSettings(runtime, prov);
      }
    }

    for (const [key, balanceState] of Object.entries(normalized.balance_checks_by_profile)) {
      const [prov, name] = splitKey(key);
      const nKey = normalizeKeyWithFallback(key, prov);
      if (!nKey) continue;

      const ts = cloneBalanceCheckState(balanceState);
      ts.provider = ts.provider ? normalizeProvider(ts.provider) : prov;
      ts.profile_name = ts.profile_name || name;
      payload.balance_checks_by_profile[nKey] = ts;
    }

    for (const [providerID, scope] of Object.entries(normalized.sessions_tab_scope_by_provider)) {
      if (isSessionListScope(scope)) {
        payload.sessions_tab_scope_by_provider[normalizeProvider(providerID)] = normalizeSessionsTabScope(scope);
      }
    }

    for (const [providerID, key] of Object.entries(normalized.sessions_tab_restore_profile_key_by_provider)) {
      const nProv = normalizeProvider(providerID);
      const nKey = normalizeKeyWithFallback(key, nProv);
      if (nKey) {
        payload.sessions_tab_restore_profile_key_by_provider[nProv] = nKey;
      }
    }

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
  }
}

/**
 * 将原始状态数据标准化为 LocalState
 * 处理遗留 selected_profile_name → selected_profile_key 迁移
 */
function normalizeState(raw: RawState): LocalState {
  const state = defaultLocalState();
  const legacyProviderID = normalizeProvider(raw.selected_provider) || DEFAULT_PROVIDER;

  state.selected_provider = legacyProviderID;
  state.global_settings = normalizeGlobalSettings(raw.global_settings ?? state.global_settings);
  state.model_mappings = raw.model_mappings ?? [];
  state.parameter_settings = normalizeParameterSettings(raw.parameter_settings);
  state.sessions_tab_scope_by_provider = {};
  state.sessions_tab_restore_profile_key_by_provider = {};
  state.working_directory_favorites = normalizeWorkingDirectoryFavorites(
    raw.working_directory_favorites,
  );
  state.session_favorites = normalizeSessionFavorites(raw.session_favorites);

  // selected_profile_key 处理
  state.selected_profile_key = normalizeKeyWithFallback(
    raw.selected_profile_key ?? "",
    legacyProviderID,
  ) || "";
  if (state.selected_profile_key) {
    const [selectedProvider] = splitKey(state.selected_profile_key);
    if (selectedProvider !== legacyProviderID) {
      state.selected_profile_key = "";
    }
  }

  // 遗留 selected_profile_name 迁移
  if (!state.selected_profile_key && raw.selected_profile_name) {
    state.selected_profile_key = buildKey(legacyProviderID, raw.selected_profile_name);
  }

  // selected by provider
  for (const [providerID, key] of Object.entries(raw.selected_profile_key_by_provider ?? {})) {
    const nProv = normalizeProvider(providerID);
    const nKey = normalizeKeyWithFallback(key, nProv);
    if (!nKey) continue;
    const [keyProvider] = splitKey(nKey);
    if (keyProvider === nProv) {
      state.selected_profile_key_by_provider[nProv] = nKey;
    }
  }
  if (state.selected_profile_key) {
    state.selected_profile_key_by_provider[legacyProviderID] = state.selected_profile_key;
  }

  // profile order
  for (const [providerID, orderedKeys] of Object.entries(raw.profile_order_by_provider ?? {})) {
    const nProv = normalizeProvider(providerID) || legacyProviderID;
    state.profile_order_by_provider[nProv] = orderedKeys
      .map((k) => normalizeKeyWithFallback(k, nProv))
      .filter(Boolean) as ProfileKey[];
  }

  // runtime by profile
  for (const [rawKey, runtime] of Object.entries(raw.runtime_by_profile ?? {})) {
    const nKey = normalizeKeyWithFallback(rawKey, legacyProviderID);
    if (!nKey) continue;
    const [prov] = splitKey(nKey);
    state.runtime_by_profile[nKey] = normalizeRuntimeSettings(runtime, prov);
  }

  for (const [rawKey, balanceState] of Object.entries(raw.balance_checks_by_profile ?? {})) {
    const nKey = normalizeKeyWithFallback(rawKey, legacyProviderID);
    if (!nKey) continue;
    const [prov, name] = splitKey(nKey);
    const ts = cloneBalanceCheckState(balanceState);
    ts.provider = ts.provider ? normalizeProvider(ts.provider) : prov;
    ts.profile_name = ts.profile_name || name;
    state.balance_checks_by_profile[nKey] = ts;
  }

  state.checkin_states_by_account = normalizeCheckinStatesByAccount(
    raw.checkin_states_by_account,
  );
  state.checkin_next_scheduled_at = typeof raw.checkin_next_scheduled_at === "string"
    ? raw.checkin_next_scheduled_at
    : "";

  for (const [providerID, scope] of Object.entries(raw.sessions_tab_scope_by_provider ?? {})) {
    if (isSessionListScope(scope)) {
      state.sessions_tab_scope_by_provider[normalizeProvider(providerID)] = normalizeSessionsTabScope(scope);
    }
  }

  for (const [providerID, key] of Object.entries(raw.sessions_tab_restore_profile_key_by_provider ?? {})) {
    const nProv = normalizeProvider(providerID);
    const nKey = normalizeKeyWithFallback(key, nProv);
    if (nKey) {
      state.sessions_tab_restore_profile_key_by_provider[nProv] = nKey;
    }
  }

  return ensureInitialized(state);
}

/**
 * 深拷贝 LocalState（翻译自 Go cloneLocalState）
 */
export function cloneLocalState(state: LocalState): LocalState {
  return {
    selected_provider: state.selected_provider,
    selected_profile_key: state.selected_profile_key,
    selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
    profile_order_by_provider: Object.fromEntries(
      Object.entries(state.profile_order_by_provider).map(([k, v]) => [k, [...v]]),
    ),
    runtime_by_profile: Object.fromEntries(
      Object.entries(state.runtime_by_profile).map(([k, v]) => [
        k,
        { ...v },
      ]),
    ),
    balance_checks_by_profile: Object.fromEntries(
      Object.entries(state.balance_checks_by_profile).map(([k, v]) => [k, cloneBalanceCheckState(v)]),
    ),
    checkin_states_by_account: normalizeCheckinStatesByAccount(state.checkin_states_by_account),
    checkin_next_scheduled_at: state.checkin_next_scheduled_at,
    global_settings: { ...state.global_settings },
    model_mappings: state.model_mappings ? [...state.model_mappings] : undefined,
    parameter_settings: { ...state.parameter_settings },
    sessions_tab_scope_by_provider: { ...state.sessions_tab_scope_by_provider },
    sessions_tab_restore_profile_key_by_provider: { ...state.sessions_tab_restore_profile_key_by_provider },
    working_directory_favorites: [...state.working_directory_favorites],
    session_favorites: state.session_favorites.map((session) => ({
      ...session,
      ...(session.user_prompts ? { user_prompts: [...session.user_prompts] } : {}),
      ...(session.conversation_excerpts ? {
        conversation_excerpts: session.conversation_excerpts.map((excerpt) => ({ ...excerpt })),
      } : {}),
    })),
  };
}

function cloneBalanceCheckItem(item: BalanceCheckItem): BalanceCheckItem {
  return {
    label: item.label,
    remaining: typeof item.remaining === "number" ? item.remaining : null,
    total: typeof item.total === "number" ? item.total : null,
    used: typeof item.used === "number" ? item.used : null,
    unit: item.unit,
  };
}

function cloneBalanceCheckState(state: BalanceCheckState): BalanceCheckState {
  return {
    provider: state.provider,
    profile_name: state.profile_name,
    base_url: state.base_url,
    running: state.running,
    supported: state.supported,
    success: state.success,
    message: state.message,
    items: Array.isArray(state.items) ? state.items.map(cloneBalanceCheckItem) : [],
    endpoint: state.endpoint ?? "",
    finished_at_display: state.finished_at_display,
  };
}
