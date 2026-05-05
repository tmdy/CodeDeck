import type { ParameterSettings } from "../parameter/types.js";
import {
  normalizeGlobalSettings,
  type GlobalSettings,
} from "../profile/types.js";
import type { LocalStateAccessor } from "./profile-service.js";
import { cloneLocalState } from "../state/store.js";

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
}
