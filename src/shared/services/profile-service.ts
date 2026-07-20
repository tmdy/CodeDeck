// Profile Service — 翻译自 Go internal/app/usecase/profile_usecase.go (525行)
// 核心业务逻辑：Profile CRUD、排序、克隆、Provider 切换

import type { Profile, ProfileKey, RuntimeSettings } from "../profile/types.js";
import {
  normalizeProfile,
  normalizeProvider,
  extractSyncedProfile,
  normalizeRuntimeSettings,
  defaultRuntimeSettings,
} from "../profile/types.js";
import {
  cloneSiteBalanceSessionsByBaseUrl,
  normalizeBalanceBaseUrl,
  normalizeSiteBalanceSessionDraft,
  normalizeSiteBalanceSessionsByBaseUrl,
  type EncryptedProfileConfig,
  type SiteBalanceSession,
  type SiteBalanceSessionDraft,
  type SiteBalanceSessionsByBaseUrl,
} from "../balance/site-balance-sessions.js";
import {
  splitKey,
  normalizeKeyWithFallback,
  itemKey,
} from "../profile/keys-internal.js";
import type { LocalState } from "../state/local-state.js";
import { normalizeWorkingDirectoryFavorites } from "../state/local-state.js";
import { cloneLocalState } from "../state/store.js";
import { getAdapter } from "../provider/registry.js";

// ---- 接口定义 ----

export interface LocalStateAccessor {
  get(): LocalState;
  save(state: LocalState): Promise<void>;
}

export interface SyncProfileStore {
  saveConfig(config: EncryptedProfileConfig): Promise<void>;
}

// ---- ProfileUseCase ----

export class ProfileService {
  private profiles: Profile[];
  private siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
  private stateAccessor: LocalStateAccessor;
  private syncStore: SyncProfileStore | null;

  constructor(
    profiles: Profile[],
    stateAccessor: LocalStateAccessor,
    syncStore: SyncProfileStore | null = null,
    siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl = {},
  ) {
    this.profiles = profiles.map((p) => normalizeProfile(p));
    this.siteBalanceSessionsByBaseUrl = normalizeSiteBalanceSessionsByBaseUrl(
      siteBalanceSessionsByBaseUrl,
    );
    this.stateAccessor = stateAccessor;
    this.syncStore = syncStore;
  }

  /** 获取所有 profiles 的副本 */
  getProfiles(): Profile[] {
    return [...this.profiles];
  }

  getSiteBalanceSessionsByBaseUrl(): SiteBalanceSessionsByBaseUrl {
    return cloneSiteBalanceSessionsByBaseUrl(this.siteBalanceSessionsByBaseUrl);
  }

  /** 获取当前状态 */
  getState(): LocalState {
    return sanitizeProviderSelectionState(this.profiles, this.stateAccessor.get());
  }

  // ---- 排序 ----

  async reorderProfiles(providerID: string, orderedKeys: ProfileKey[]): Promise<void> {
    const st = this.getState();
    st.profile_order_by_provider[normalizeProvider(providerID)] = [...orderedKeys];
    await this.stateAccessor.save(st);
  }

  // ---- 选择 ----

  async selectProfile(providerID: string, selectedKey: ProfileKey): Promise<void> {
    const nProv = normalizeProvider(providerID);
    const nKey = normalizeKeyWithFallback(selectedKey, nProv);
    if (!belongsToProvider(nKey, nProv)) {
      throw new Error("所选 Profile 与当前 provider 不匹配。");
    }
    if (!profileExists(this.profiles, nKey)) {
      throw new Error(`profile not found: ${nKey}`);
    }
    const st = this.getState();
    st.selected_provider = nProv;
    st.selected_profile_key = nKey;
    st.selected_profile_key_by_provider[nProv] = nKey;
    await this.stateAccessor.save(st);
  }

  // ---- Provider 切换 ----

  async activateProvider(providerID: string): Promise<void> {
    const st = this.getState();
    const nProv = normalizeProvider(providerID);
    st.selected_provider = nProv;

    let candidate = resolveRememberedSelection(
      this.profiles,
      st.selected_profile_key_by_provider[nProv] ?? "",
      nProv,
    );
    if (!candidate) {
      candidate = selectProfileForProvider(this.profiles, st, nProv);
    }
    st.selected_profile_key = candidate;
    if (!candidate) {
      delete st.selected_profile_key_by_provider[nProv];
    } else {
      st.selected_profile_key_by_provider[nProv] = candidate;
    }

    await this.stateAccessor.save(st);
  }

  async updateWorkingDirectoryFavorites(favorites: unknown): Promise<string[]> {
    const st = this.getState();
    st.working_directory_favorites = normalizeWorkingDirectoryFavorites(favorites);
    await this.stateAccessor.save(st);
    return st.working_directory_favorites;
  }

  async updateProfileRuntimeSettings(
    profileKey: ProfileKey,
    patch: Partial<RuntimeSettings>,
  ): Promise<RuntimeSettings> {
    const nKey = normalizeKeyWithFallback(profileKey, this.getState().selected_provider);
    const profile = this.findByKey(nKey);
    if (!profile) {
      throw new Error(`profile not found: ${profileKey}`);
    }

    const st = this.getState();
    const currentRuntime = st.runtime_by_profile[nKey] ?? defaultRuntimeSettings(profile.provider);
    const nextRuntime = normalizeRuntimeSettings({
      ...currentRuntime,
      ...patch,
    }, profile.provider);
    st.runtime_by_profile[nKey] = nextRuntime;
    await this.stateAccessor.save(st);
    return nextRuntime;
  }

  // ---- 保存（创建/更新） ----

  async saveProfile(
    targetKey: ProfileKey,
    draft: Profile,
    runtime: RuntimeSettings,
  ): Promise<Profile> {
    const nProv = normalizeProvider(draft.provider);
    let nd = normalizeProfile({ ...draft, provider: nProv });

    // 验证
    if (!nd.name) throw new Error("名称不能为空");
    if (!nd.url) throw new Error("Base URL 不能为空");
    if (!nd.key) throw new Error("Key / Token 不能为空");
    if (!validateHttpUrl(nd.url)) throw new Error("Base URL 必须以 http:// 或 https:// 开头");

    // Provider 特定的规范化
    const adapter = getAdapter(nProv);
    nd = adapter.normalizeProfile(nd);

    // 检查名称重复
    const nTargetKey = normalizeKeyWithFallback(targetKey, nProv);
    for (const item of this.profiles) {
      if (itemKey(item) === nTargetKey) continue;
      if (normalizeProvider(item.provider) === nProv && item.name === nd.name) {
        throw new Error(`名称重复：${nd.name}`);
      }
    }

    // 查找现有 profile
    let index = -1;
    let previous: Profile | undefined;
    if (nTargetKey) {
      for (let i = 0; i < this.profiles.length; i++) {
        if (itemKey(this.profiles[i]) === nTargetKey) {
          index = i;
          previous = this.profiles[i];
          break;
        }
      }
      if (index < 0) throw new Error(`profile not found: ${nTargetKey}`);
    }

    const previousBaseUrl = previous ? normalizeBalanceBaseUrl(previous.url) : "";
    const nextBaseUrl = normalizeBalanceBaseUrl(nd.url);
    if (previous && previousBaseUrl !== nextBaseUrl) {
      nd = { ...nd, balance_session_id: undefined };
    }

    const nextProfiles = this.profiles.map((p) => ({ ...p }));
    if (index >= 0) {
      nextProfiles[index] = nd;
    } else {
      nextProfiles.push(nd);
    }

    const st = this.getState();
    const nRuntime = normalizeRuntimeSettings(runtime, nProv);
    const newKey = itemKey(nd);

    if (index >= 0 && previous) {
      const previousKey = itemKey(previous);
      if (previousKey !== newKey) {
        migrateProfileStateKey(st, previousKey, newKey, nd);
        const [prevProv] = splitKey(previousKey);
        if (prevProv !== nProv) {
          st.profile_order_by_provider[prevProv] = removeProfileKey(
            st.profile_order_by_provider[prevProv] ?? [],
            previousKey,
          );
        }
      }
      st.profile_order_by_provider[nProv] = replaceOrAppendProfileKey(
        st.profile_order_by_provider[nProv] ?? [],
        previousKey,
        newKey,
      );
    } else {
      st.profile_order_by_provider[nProv] = appendMissingProfileKey(
        st.profile_order_by_provider[nProv] ?? [],
        newKey,
      );
    }

    st.runtime_by_profile[newKey] = nRuntime;
    st.selected_provider = nProv;
    st.selected_profile_key = newKey;
    st.selected_profile_key_by_provider[nProv] = newKey;

    await this.saveConfig(nextProfiles, this.siteBalanceSessionsByBaseUrl);
    this.profiles = nextProfiles;
    await this.stateAccessor.save(st);

    return nd;
  }

  // ---- 克隆 ----

  async cloneProfileToProvider(
    sourceKey: ProfileKey,
    targetProviderID: string,
  ): Promise<Profile> {
    const source = this.findByKey(sourceKey);
    if (!source) throw new Error(`source profile not found: ${sourceKey}`);

    const targetProv = normalizeProvider(targetProviderID);
    const adapter = getAdapter(targetProv);

    let cloned: Profile = {
      provider: targetProv,
      name: this.allocateCloneName(targetProv, source.name),
      url: source.url,
      key: source.key,
      permissions: source.permissions,
      balance_session_id: source.balance_session_id,
    };
    cloned = normalizeProfile(adapter.normalizeProfile(cloned));

    const nextProfiles = [...this.profiles.map((p) => ({ ...p })), cloned];
    const clonedKey = itemKey(cloned);
    const st = this.getState();
    st.runtime_by_profile[clonedKey] = defaultRuntimeSettings(targetProv);
    st.selected_provider = targetProv;
    st.selected_profile_key = clonedKey;
    st.selected_profile_key_by_provider[targetProv] = clonedKey;
    st.profile_order_by_provider[targetProv] = [
      ...(st.profile_order_by_provider[targetProv] ?? []),
      clonedKey,
    ];

    await this.saveConfig(nextProfiles, this.siteBalanceSessionsByBaseUrl);
    this.profiles = nextProfiles;
    await this.stateAccessor.save(st);

    return cloned;
  }

  // ---- 删除 ----

  async deleteProfile(key: ProfileKey): Promise<void> {
    const nKey = normalizeKeyWithFallback(key, "claude");
    const [provID] = splitKey(nKey);

    const index = this.profiles.findIndex((p) => itemKey(p) === nKey);
    if (index < 0) throw new Error(`profile not found: ${nKey}`);

    const nextProfiles = [
      ...this.profiles.slice(0, index),
      ...this.profiles.slice(index + 1),
    ];

    const st = cloneLocalState(this.stateAccessor.get());

    delete st.runtime_by_profile[nKey];
    delete st.balance_checks_by_profile[nKey];
    st.profile_order_by_provider[provID] = removeProfileKey(
      st.profile_order_by_provider[provID] ?? [],
      nKey,
    );

    let selectedForProvider = normalizeKeyWithFallback(
      st.selected_profile_key_by_provider[provID] ?? "",
      provID,
    );
    if (
      selectedForProvider === nKey ||
      (selectedForProvider && !profileExists(nextProfiles, selectedForProvider))
    ) {
      delete st.selected_profile_key_by_provider[provID];
      selectedForProvider = "";
    }
    const restoreProfileKey = normalizeKeyWithFallback(
      st.sessions_tab_restore_profile_key_by_provider[provID] ?? "",
      provID,
    );
    if (
      restoreProfileKey === nKey ||
      (restoreProfileKey && !profileExists(nextProfiles, restoreProfileKey))
    ) {
      delete st.sessions_tab_restore_profile_key_by_provider[provID];
    }

    if (normalizeProvider(st.selected_provider) === provID) {
      const currentSelected = normalizeKeyWithFallback(st.selected_profile_key, provID);
      if (currentSelected === nKey) {
        st.selected_profile_key = "";
      } else if (currentSelected && !profileExists(nextProfiles, currentSelected)) {
        st.selected_profile_key = selectedForProvider;
      }
    }

    await this.saveConfig(nextProfiles, this.siteBalanceSessionsByBaseUrl);
    this.profiles = nextProfiles;
    await this.stateAccessor.save(st);
  }

  async saveSiteBalanceSession(
    rawBaseUrl: string,
    draft: SiteBalanceSessionDraft,
  ): Promise<SiteBalanceSession> {
    const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
    if (!baseUrl) {
      throw new Error("Base URL 不能为空");
    }
    if (!validateHttpUrl(baseUrl)) {
      throw new Error("Base URL 必须以 http:// 或 https:// 开头");
    }

    const normalizedDraft = normalizeSiteBalanceSessionDraft(draft);
    if (!normalizedDraft.access_token) {
      throw new Error("Access Token 不能为空");
    }
    const nextSessionsByBaseUrl = this.getSiteBalanceSessionsByBaseUrl();
    const currentSessions = nextSessionsByBaseUrl[baseUrl] ?? [];
    const sessionId = normalizedDraft.id ?? allocateSessionId();
    const existingSession = normalizedDraft.id
      ? currentSessions.find((session) => session.id === normalizedDraft.id)
      : undefined;
    const label = normalizedDraft.label
      || existingSession?.label
      || `账号${currentSessions.length + 1}`;
    const nextSession: SiteBalanceSession = {
      id: sessionId,
      label,
      base_url: baseUrl,
      access_token: normalizedDraft.access_token,
      ...(normalizedDraft.refresh_token ? { refresh_token: normalizedDraft.refresh_token } : {}),
      ...(normalizedDraft.token_expires_at ? { token_expires_at: normalizedDraft.token_expires_at } : {}),
      user_id: normalizedDraft.user_id,
      auto_checkin_enabled: existingSession?.auto_checkin_enabled ?? false,
      updated_at: new Date().toISOString(),
    };

    const index = currentSessions.findIndex((session) => session.id === sessionId);
    const nextSessions = currentSessions.map((session) => ({ ...session }));
    if (index >= 0) {
      nextSessions[index] = nextSession;
    } else {
      nextSessions.push(nextSession);
    }
    nextSessionsByBaseUrl[baseUrl] = nextSessions;

    await this.saveConfig(this.profiles, nextSessionsByBaseUrl);
    this.siteBalanceSessionsByBaseUrl = nextSessionsByBaseUrl;

    return { ...nextSession };
  }

  async updateSiteBalanceSessionAutoCheckin(
    rawBaseUrl: string,
    sessionId: string,
    enabled: boolean,
  ): Promise<SiteBalanceSession> {
    const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
    const nextSessionsByBaseUrl = this.getSiteBalanceSessionsByBaseUrl();
    const sessions = nextSessionsByBaseUrl[baseUrl] ?? [];
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) {
      throw new Error("后台账号不存在");
    }
    const nextSession: SiteBalanceSession = {
      ...sessions[index],
      auto_checkin_enabled: enabled,
      updated_at: new Date().toISOString(),
    };
    nextSessionsByBaseUrl[baseUrl] = sessions.map((session, currentIndex) => (
      currentIndex === index ? nextSession : { ...session }
    ));
    await this.saveConfig(this.profiles, nextSessionsByBaseUrl);
    this.siteBalanceSessionsByBaseUrl = nextSessionsByBaseUrl;
    return { ...nextSession };
  }

  async deleteSiteBalanceSession(rawBaseUrl: string, sessionId: string): Promise<void> {
    const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
    const nextSessionsByBaseUrl = this.getSiteBalanceSessionsByBaseUrl();
    const currentSessions = nextSessionsByBaseUrl[baseUrl] ?? [];
    const nextSessions = currentSessions.filter((session) => session.id !== sessionId);

    if (nextSessions.length > 0) {
      nextSessionsByBaseUrl[baseUrl] = nextSessions;
    } else {
      delete nextSessionsByBaseUrl[baseUrl];
    }

    const nextProfiles = this.profiles.map((profile) => {
      if (
        normalizeBalanceBaseUrl(profile.url) === baseUrl
        && profile.balance_session_id === sessionId
      ) {
        return {
          ...profile,
          balance_session_id: undefined,
        };
      }
      return { ...profile };
    });

    const state = this.getState();
    const deletedAccountKey = `${baseUrl}::${sessionId}`;
    delete state.checkin_states_by_account[deletedAccountKey];

    await this.saveConfig(nextProfiles, nextSessionsByBaseUrl);
    this.profiles = nextProfiles;
    this.siteBalanceSessionsByBaseUrl = nextSessionsByBaseUrl;
    await this.stateAccessor.save(state);
  }

  // ---- 内部方法 ----

  private findByKey(key: ProfileKey): Profile | undefined {
    return this.profiles.find((p) => itemKey(p) === key);
  }

  private allocateCloneName(targetProv: string, baseName: string): string {
    if (!this.nameExists(targetProv, baseName)) return baseName;

    const suffix = targetProv === "claude" ? " (Claude)" : " (Codex)";
    let candidate = baseName + suffix;
    if (!this.nameExists(targetProv, candidate)) return candidate;

    let idx = 2;
    while (true) {
      candidate = `${baseName}${suffix} ${idx}`;
      if (!this.nameExists(targetProv, candidate)) return candidate;
      idx++;
    }
  }

  private nameExists(providerID: string, name: string): boolean {
    return this.profiles.some(
      (p) => normalizeProvider(p.provider) === normalizeProvider(providerID) && p.name === name,
    );
  }

  private async saveConfig(
    profiles: Profile[],
    siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
  ): Promise<void> {
    if (!this.syncStore) return;
    await this.syncStore.saveConfig({
      profiles: profiles.map(extractSyncedProfile),
      site_balance_sessions_by_base_url: cloneSiteBalanceSessionsByBaseUrl(
        siteBalanceSessionsByBaseUrl,
      ),
    });
  }
}

// ---- 辅助函数（翻译自 Go） ----

function removeProfileKey(keys: ProfileKey[], target: ProfileKey): ProfileKey[] {
  return keys.filter((k) => k !== target);
}

function appendMissingProfileKey(keys: ProfileKey[], target: ProfileKey): ProfileKey[] {
  if (keys.includes(target)) return [...keys];
  return [...keys, target];
}

function replaceOrAppendProfileKey(
  keys: ProfileKey[],
  previous: ProfileKey,
  next: ProfileKey,
): ProfileKey[] {
  let replaced = false;
  const out: ProfileKey[] = [];
  for (const k of keys) {
    if (k !== previous) {
      out.push(k);
    } else if (!replaced) {
      out.push(next);
      replaced = true;
    }
  }
  if (!replaced) out.push(next);
  return out;
}

function selectProfileForProvider(
  profiles: Profile[],
  st: LocalState,
  providerID: string,
): ProfileKey {
  for (const k of st.profile_order_by_provider[providerID] ?? []) {
    if (belongsToProvider(k, providerID) && profileExists(profiles, k)) return k;
  }
  for (const item of profiles) {
    if (normalizeProvider(item.provider) === providerID) return itemKey(item);
  }
  return "";
}

function belongsToProvider(key: ProfileKey, providerID: string): boolean {
  if (!key) return false;
  const [keyProvider] = splitKey(key);
  return normalizeProvider(keyProvider) === normalizeProvider(providerID);
}

function resolveRememberedSelection(
  profiles: Profile[],
  key: ProfileKey,
  providerID: string,
): ProfileKey {
  const normalized = normalizeKeyWithFallback(key, providerID);
  if (!normalized || !belongsToProvider(normalized, providerID)) {
    return "";
  }
  return profileExists(profiles, normalized) ? normalized : "";
}

function sanitizeProviderSelectionState(profiles: Profile[], state: LocalState): LocalState {
  const next = cloneLocalState(state);

  for (const [providerID, rememberedKey] of Object.entries(next.selected_profile_key_by_provider)) {
    const resolved = resolveRememberedSelection(profiles, rememberedKey, providerID);
    if (resolved) {
      next.selected_profile_key_by_provider[normalizeProvider(providerID)] = resolved;
    } else {
      delete next.selected_profile_key_by_provider[normalizeProvider(providerID)];
    }
  }

  for (const [providerID, rememberedKey] of Object.entries(next.sessions_tab_restore_profile_key_by_provider)) {
    const resolved = resolveRememberedSelection(profiles, rememberedKey, providerID);
    if (resolved) {
      next.sessions_tab_restore_profile_key_by_provider[normalizeProvider(providerID)] = resolved;
    } else {
      delete next.sessions_tab_restore_profile_key_by_provider[normalizeProvider(providerID)];
    }
  }

  const activeProvider = normalizeProvider(next.selected_provider);
  next.selected_provider = activeProvider;

  const activeSelected = resolveRememberedSelection(profiles, next.selected_profile_key, activeProvider);
  const rememberedSelected = resolveRememberedSelection(
    profiles,
    next.selected_profile_key_by_provider[activeProvider] ?? "",
    activeProvider,
  );
  const fallbackSelected = selectProfileForProvider(profiles, next, activeProvider);
  const finalSelected = activeSelected || rememberedSelected || fallbackSelected;

  next.selected_profile_key = finalSelected;
  if (finalSelected) {
    next.selected_profile_key_by_provider[activeProvider] = finalSelected;
  } else {
    delete next.selected_profile_key_by_provider[activeProvider];
  }

  return next;
}

function migrateProfileStateKey(
  st: LocalState,
  previousKey: ProfileKey,
  nextKey: ProfileKey,
  saved: Profile,
): void {
  if (st.runtime_by_profile[previousKey] !== undefined) {
    st.runtime_by_profile[nextKey] = st.runtime_by_profile[previousKey];
    delete st.runtime_by_profile[previousKey];
  }
  if (st.balance_checks_by_profile[previousKey] !== undefined) {
    st.balance_checks_by_profile[nextKey] = {
      ...st.balance_checks_by_profile[previousKey],
      provider: saved.provider,
      profile_name: saved.name,
      items: st.balance_checks_by_profile[previousKey].items.map((item) => ({ ...item })),
    };
    delete st.balance_checks_by_profile[previousKey];
  }
  for (const [pID, selKey] of Object.entries(st.selected_profile_key_by_provider)) {
    if (selKey === previousKey) {
      st.selected_profile_key_by_provider[pID] = nextKey;
    }
  }
  if (st.selected_profile_key === previousKey) {
    st.selected_profile_key = nextKey;
  }
  for (const [providerID, restoreProfileKey] of Object.entries(st.sessions_tab_restore_profile_key_by_provider)) {
    if (restoreProfileKey === previousKey) {
      st.sessions_tab_restore_profile_key_by_provider[providerID] = nextKey;
    }
  }
}

export function validateHttpUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  const lower = rawUrl.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

export function profileExists(profiles: Profile[], target: ProfileKey): boolean {
  if (!target) return false;
  return profiles.some((p) => itemKey(p) === target);
}

function allocateSessionId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}
