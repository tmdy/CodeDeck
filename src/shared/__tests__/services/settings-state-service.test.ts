import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStateService } from "../../services/settings-state-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import type { LocalStateAccessor } from "../../services/profile-service.js";

class MemoryStateAccessor implements LocalStateAccessor {
  private state: LocalState;

  constructor(initial?: Partial<LocalState>) {
    this.state = { ...defaultLocalState(), ...initial };
  }

  get(): LocalState {
    return cloneLocalState(this.state);
  }

  async save(state: LocalState): Promise<void> {
    this.state = cloneLocalState(state);
  }
}

describe("SettingsStateService", () => {
  let accessor: MemoryStateAccessor;
  let service: SettingsStateService;

  beforeEach(() => {
    accessor = new MemoryStateAccessor();
    service = new SettingsStateService(accessor);
  });

  it("should update parameter settings without requiring a selected profile", async () => {
    const saved = vi.spyOn(accessor, "save");

    await service.updateParameterSettings({
      launch_timeout_ms: 45000,
    });

    const state = accessor.get();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(state.parameter_settings.launch_timeout_ms).toBe(45000);
    expect(state.selected_profile_key).toBe("");
    expect(state.runtime_by_profile).toEqual({});
  });

  it("should update global settings without touching profile runtime", async () => {
    await accessor.save({
      ...defaultLocalState(),
      selected_profile_key: "claude::Official",
      runtime_by_profile: {
        "claude::Official": {
          cwd: "C:/repo",
          command_base: "claude",
          model: "",
          launch_mode: "new",
          extra_args: "",
          exclude_user_settings: true,
        },
      },
    });

    await service.updateGlobalSettings({
      proxy: "http://127.0.0.1:7890",
    });

    const state = accessor.get();
    expect(state.global_settings.proxy).toBe("http://127.0.0.1:7890");
    expect(state.runtime_by_profile["claude::Official"]).toEqual({
      cwd: "C:/repo",
      command_base: "claude",
      model: "",
      launch_mode: "new",
      extra_args: "",
      exclude_user_settings: true,
    });
  });
});
