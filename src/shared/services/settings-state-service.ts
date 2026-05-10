import type { ParameterSettings } from "../parameter/types.js";
import {
  normalizeGlobalSettings,
  type GlobalSettings,
} from "../profile/types.js";
import type { LocalStateAccessor } from "./profile-service.js";
import { cloneLocalState } from "../state/store.js";
import { type SessionListScope } from "./session-service.js";
import { normalizeSessionsTabScope } from "../session-history-state.js";
import { normalizeKeyWithFallback } from "../profile/keys-internal.js";
import { normalizeProvider, type ProfileKey } from "../profile/types.js";

export interface SessionsTabStatePatch {
  scope?: SessionListScope;
  restore_profile_key?: ProfileKey;
}

export class SettingsStateService {
  constructor(private stateAccessor: LocalStateAccessor) {}

  getParameterSettings(): ParameterSettings {
    return this.stateAccessor.get().parameter_settings;
  }

  async updateParameterSettings(settings: Partial<ParameterSettings>): Promise<ParameterSettings> {
    const state = cloneLocalState(this.stateAccessor.get());
    state.parameter_settings = {
      ...state.parameter_settings,
      ...settings,
    };
    await this.stateAccessor.save(state);
    return state.parameter_settings;
  }

  getGlobalSettings(): GlobalSettings {
    return this.stateAccessor.get().global_settings;
  }

  async updateGlobalSettings(settings: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const state = cloneLocalState(this.stateAccessor.get());
    state.global_settings = normalizeGlobalSettings({
      ...state.global_settings,
      ...settings,
    });
    await this.stateAccessor.save(state);
    return state.global_settings;
  }

  async updateSessionsTabState(
    providerID: string,
    patch: SessionsTabStatePatch,
  ): Promise<void> {
    const state = cloneLocalState(this.stateAccessor.get());
    const normalizedProvider = normalizeProvider(providerID);

    if (patch.scope) {
      state.sessions_tab_scope_by_provider[normalizedProvider] = normalizeSessionsTabScope(patch.scope);
    }

    if (patch.restore_profile_key !== undefined) {
      const normalizedKey = normalizeKeyWithFallback(
        patch.restore_profile_key,
        normalizedProvider,
      );
      if (normalizedKey) {
        state.sessions_tab_restore_profile_key_by_provider[normalizedProvider] = normalizedKey;
      } else {
        delete state.sessions_tab_restore_profile_key_by_provider[normalizedProvider];
      }
    }

    await this.stateAccessor.save(state);
  }
}
