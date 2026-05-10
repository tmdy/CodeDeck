import { itemKey, normalizeKeyWithFallback, splitKey } from "./profile/keys-internal.js";
import { normalizeProvider, type Profile, type ProfileKey } from "./profile/types.js";
import type { SessionListScope } from "./services/session-service.js";
import type { LocalState } from "./state/local-state.js";

function belongsToProvider(key: ProfileKey, provider: string): boolean {
  if (!key) {
    return false;
  }
  const [keyProvider] = splitKey(key);
  return normalizeProvider(keyProvider) === normalizeProvider(provider);
}

function profileExists(profiles: Profile[], targetKey: ProfileKey): boolean {
  return profiles.some((profile) => itemKey(profile) === targetKey);
}

export function listProfilesForProvider(profiles: Profile[], provider: string): Profile[] {
  const normalizedProvider = normalizeProvider(provider);
  return profiles.filter((profile) => normalizeProvider(profile.provider) === normalizedProvider);
}

export function resolveHistoryScope(
  state: Pick<LocalState, "sessions_tab_scope_by_provider"> | null | undefined,
  provider: string,
  _projectCwd: string,
): SessionListScope {
  const remembered = state?.sessions_tab_scope_by_provider?.[normalizeProvider(provider)];
  return normalizeSessionsTabScope(remembered);
}

export function normalizeSessionsTabScope(_scope: SessionListScope | undefined): SessionListScope {
  return "global_recent";
}

export function resolveHistoryRestoreProfileKey(
  state: Pick<
    LocalState,
    "selected_provider" | "selected_profile_key" | "selected_profile_key_by_provider" | "sessions_tab_restore_profile_key_by_provider"
  > | null | undefined,
  profiles: Profile[],
  provider: string,
): ProfileKey {
  const normalizedProvider = normalizeProvider(provider);
  const remembered = normalizeKeyWithFallback(
    state?.sessions_tab_restore_profile_key_by_provider?.[normalizedProvider] ?? "",
    normalizedProvider,
  );
  if (remembered && belongsToProvider(remembered, normalizedProvider) && profileExists(profiles, remembered)) {
    return remembered;
  }

  const activeKey = normalizeKeyWithFallback(
    state?.selected_profile_key_by_provider?.[normalizedProvider]
      ?? (normalizeProvider(state?.selected_provider ?? normalizedProvider) === normalizedProvider
        ? state?.selected_profile_key ?? ""
        : ""),
    normalizedProvider,
  );
  if (activeKey && belongsToProvider(activeKey, normalizedProvider) && profileExists(profiles, activeKey)) {
    return activeKey;
  }

  const fallbackProfile = listProfilesForProvider(profiles, normalizedProvider)[0];
  return fallbackProfile ? itemKey(fallbackProfile) : "";
}
