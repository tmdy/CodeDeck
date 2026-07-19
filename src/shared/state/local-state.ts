// 本地状态模型 — 翻译自 Go internal/domain/state/local_state.go
// 扩展了模型映射和参数设置字段

import type { ProfileKey } from "../profile/types.js";
import type { RuntimeSettings, GlobalSettings } from "../profile/types.js";
import { DEFAULT_PROVIDER, PROVIDER_CLAUDE, PROVIDER_CODEX, normalizeProvider, defaultGlobalSettings } from "../profile/types.js";
import type { BalanceCheckState } from "../balance/types.js";
import type { ParameterSettings } from "../parameter/types.js";
import { defaultParameterSettings, normalizeParameterSettings } from "../parameter/types.js";
import type { CodexSessionSourceKind, SessionConversationExcerpt, SessionListScope, SessionSummary } from "../services/session-service.js";
import type { Profile } from "../profile/types.js";
import type { SiteBalanceSessionsByBaseUrl } from "../balance/site-balance-sessions.js";
import {
  normalizeCheckinStatesByAccount,
  type CheckinStatesByAccount,
} from "../checkin/types.js";

export interface FavoriteSessionSummary extends SessionSummary {
  favorite_key: string;
  favorited_at: string;
}

export interface LocalState {
  selected_provider: string;
  selected_profile_key: ProfileKey;
  selected_profile_key_by_provider: Record<string, ProfileKey>;
  profile_order_by_provider: Record<string, ProfileKey[]>;
  runtime_by_profile: Record<ProfileKey, RuntimeSettings>;
  balance_checks_by_profile: Record<ProfileKey, BalanceCheckState>;
  checkin_states_by_account: CheckinStatesByAccount;
  checkin_next_scheduled_at: string;
  global_settings: GlobalSettings;
  /** 遗留的全局模型映射配置，仅为兼容旧状态读取 */
  model_mappings?: unknown[];
  /** 参数设置 */
  parameter_settings: ParameterSettings;
  /** 会话页每个 provider 当前选中的范围 */
  sessions_tab_scope_by_provider: Record<string, SessionListScope>;
  /** 会话页每个 provider 最近一次用于恢复的 profile */
  sessions_tab_restore_profile_key_by_provider: Record<string, ProfileKey>;
  /** 全局共享的工作目录收藏 */
  working_directory_favorites: string[];
  /** 会话页跨 provider 收藏 */
  session_favorites: FavoriteSessionSummary[];
}

export type BootstrapLocalState = Pick<
  LocalState,
  | "selected_provider"
  | "selected_profile_key"
  | "selected_profile_key_by_provider"
  | "profile_order_by_provider"
  | "runtime_by_profile"
  | "balance_checks_by_profile"
  | "global_settings"
> & {
  checkin_states_by_account?: CheckinStatesByAccount;
  checkin_next_scheduled_at?: string;
  working_directory_favorites?: string[];
  session_favorites?: FavoriteSessionSummary[];
};

export interface BootstrapResult {
  profiles: Profile[];
  state: BootstrapLocalState;
  siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
  defaultWorkingDirectory: string;
}

export function defaultLocalState(): LocalState {
  return {
    selected_provider: DEFAULT_PROVIDER,
    selected_profile_key: "",
    selected_profile_key_by_provider: {},
    profile_order_by_provider: {},
    runtime_by_profile: {},
    balance_checks_by_profile: {},
    checkin_states_by_account: {},
    checkin_next_scheduled_at: "",
    global_settings: defaultGlobalSettings(),
    parameter_settings: defaultParameterSettings(),
    sessions_tab_scope_by_provider: {},
    sessions_tab_restore_profile_key_by_provider: {},
    working_directory_favorites: [],
    session_favorites: [],
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
  state.balance_checks_by_profile ??= {};
  state.checkin_states_by_account = normalizeCheckinStatesByAccount(
    state.checkin_states_by_account,
  );
  state.checkin_next_scheduled_at = typeof state.checkin_next_scheduled_at === "string"
    ? state.checkin_next_scheduled_at
    : "";
  state.global_settings ??= defaultGlobalSettings();
  state.parameter_settings = normalizeParameterSettings(
    state.parameter_settings ?? defaultParameterSettings(),
  );
  state.sessions_tab_scope_by_provider ??= {};
  state.sessions_tab_restore_profile_key_by_provider ??= {};
  state.working_directory_favorites = normalizeWorkingDirectoryFavorites(
    state.working_directory_favorites,
  );
  state.session_favorites = normalizeSessionFavorites(state.session_favorites);

  return state;
}

export function mergeBootstrapState(state: BootstrapLocalState): LocalState {
  return ensureInitialized({
    ...defaultLocalState(),
    ...state,
    selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
    profile_order_by_provider: { ...state.profile_order_by_provider },
    runtime_by_profile: { ...state.runtime_by_profile },
    balance_checks_by_profile: { ...state.balance_checks_by_profile },
    checkin_states_by_account: normalizeCheckinStatesByAccount(state.checkin_states_by_account),
    checkin_next_scheduled_at: state.checkin_next_scheduled_at ?? "",
    global_settings: state.global_settings ?? defaultGlobalSettings(),
    working_directory_favorites: normalizeWorkingDirectoryFavorites(
      state.working_directory_favorites,
    ),
    session_favorites: normalizeSessionFavorites(state.session_favorites),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeFavoriteProvider(value: unknown): "claude" | "codex" | "" {
  if (typeof value !== "string") {
    return "";
  }
  const provider = value.trim().toLowerCase();
  if (provider === PROVIDER_CLAUDE || provider === PROVIDER_CODEX) {
    return provider;
  }
  return "";
}

function normalizeFavoriteSourceKind(value: unknown): CodexSessionSourceKind | undefined {
  if (value === "app_runtime" || value === "global_codex") {
    return value;
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.trim();
    if (text) {
      result.push(text);
    }
  }
  return result;
}

function normalizeConversationExcerpts(value: unknown): SessionConversationExcerpt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const excerpts: SessionConversationExcerpt[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const role = record.role === "user" || record.role === "assistant" ? record.role : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (role && text) {
      excerpts.push({ role, text });
    }
  }
  return excerpts;
}

function escapeFavoriteKeyPart(value: string): string {
  return value.replaceAll("|", "%7C");
}

export function getSessionFavoriteKey(
  session: Pick<SessionSummary, "provider" | "session_id" | "source_kind" | "source_home">,
): string {
  return [
    normalizeFavoriteProvider(session.provider),
    session.source_kind?.trim() ?? "",
    session.source_home?.trim() ?? "",
    session.session_id.trim(),
  ].map(escapeFavoriteKeyPart).join("|");
}

export function normalizeSessionFavorites(value: unknown): FavoriteSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const favorites: FavoriteSessionSummary[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const provider = normalizeFavoriteProvider(record.provider);
    const sessionId = typeof record.session_id === "string" ? record.session_id.trim() : "";
    const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
    const updatedAt = typeof record.updated_at === "string" ? record.updated_at.trim() : "";
    const preview = typeof record.preview === "string" ? record.preview.trim() : "";
    const favoritedAt = typeof record.favorited_at === "string" ? record.favorited_at.trim() : "";
    if (!provider || !sessionId || !favoritedAt) {
      continue;
    }

    const sourceKind = normalizeFavoriteSourceKind(record.source_kind);
    const sourceHome = typeof record.source_home === "string" ? record.source_home.trim() : "";
    const sourceFileRelativePath = typeof record.source_file_relative_path === "string"
      ? record.source_file_relative_path.trim()
      : "";
    const favoriteBase: SessionSummary = {
      provider,
      session_id: sessionId,
      cwd,
      updated_at: updatedAt || favoritedAt,
      preview: preview || sessionId,
      ...(sourceKind ? { source_kind: sourceKind } : {}),
      ...(sourceHome ? { source_home: sourceHome } : {}),
      ...(sourceFileRelativePath ? { source_file_relative_path: sourceFileRelativePath } : {}),
    };
    const favoriteKey = getSessionFavoriteKey(favoriteBase);
    if (!favoriteKey || seen.has(favoriteKey)) {
      continue;
    }
    seen.add(favoriteKey);

    const userPrompts = normalizeStringArray(record.user_prompts);
    const conversationExcerpts = normalizeConversationExcerpts(record.conversation_excerpts);
    favorites.push({
      ...favoriteBase,
      favorite_key: favoriteKey,
      favorited_at: favoritedAt,
      ...(userPrompts.length > 0 ? { user_prompts: userPrompts } : {}),
      ...(conversationExcerpts.length > 0 ? { conversation_excerpts: conversationExcerpts } : {}),
    });
  }
  return favorites;
}

export function normalizeWorkingDirectoryFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const favorites: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const favorite = item.trim();
    if (!favorite || seen.has(favorite)) {
      continue;
    }
    seen.add(favorite);
    favorites.push(favorite);
  }
  return favorites;
}
