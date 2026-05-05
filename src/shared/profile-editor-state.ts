import type {
  AdvancedModelMapping,
  Profile,
  RuntimeSettings,
  LaunchMode,
} from "./profile/types.js";
import { defaultRuntimeSettings } from "./profile/types.js";

export interface ProfileEditorDraft {
  name: string;
  url: string;
  key: string;
  selectedModelId: string;
  advancedModelMapping: AdvancedModelMapping;
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    user_id: string;
  };
  cwd: string;
  command_base: string;
  settings_file: string;
  launch_mode: LaunchMode;
  extra_args: string;
  exclude_user_settings: boolean;
}

export function buildSelectedProfileDraft(
  profile: Profile,
  runtime: RuntimeSettings | undefined,
  provider: string,
  balanceSessionDraft?: {
    label?: string;
    access_token?: string;
    user_id?: string;
  },
): ProfileEditorDraft {
  const baseRuntime = runtime ?? defaultRuntimeSettings(provider);
  return {
    name: profile.name,
    url: profile.url,
    key: profile.key,
    selectedModelId: profile.selectedModelId ?? baseRuntime.model ?? "",
    advancedModelMapping: cloneAdvancedModelMapping(profile.advancedModelMapping),
    balanceSessionSelection: profile.balance_session_id ?? "auto",
    balanceSessionDraft: {
      label: balanceSessionDraft?.label ?? "",
      access_token: balanceSessionDraft?.access_token ?? "",
      user_id: balanceSessionDraft?.user_id ?? "",
    },
    cwd: baseRuntime.cwd,
    command_base: baseRuntime.command_base,
    settings_file: baseRuntime.settings_file ?? "",
    launch_mode: baseRuntime.launch_mode,
    extra_args: baseRuntime.extra_args,
    exclude_user_settings: baseRuntime.exclude_user_settings,
  };
}

export function buildNewProfileDraft(provider: string): ProfileEditorDraft {
  const runtime = defaultRuntimeSettings(provider);
  return {
    name: "",
    url: "",
    key: "",
    selectedModelId: "",
    advancedModelMapping: cloneAdvancedModelMapping(undefined),
    balanceSessionSelection: "auto",
    balanceSessionDraft: {
      label: "",
      access_token: "",
      user_id: "",
    },
    cwd: runtime.cwd,
    command_base: runtime.command_base,
    settings_file: runtime.settings_file ?? "",
    launch_mode: runtime.launch_mode,
    extra_args: runtime.extra_args,
    exclude_user_settings: runtime.exclude_user_settings,
  };
}

export function buildRuntimeSettingsFromDraft(draft: ProfileEditorDraft): RuntimeSettings {
  return {
    cwd: draft.cwd,
    command_base: draft.command_base,
    model: "",
    settings_file: draft.settings_file,
    launch_mode: draft.launch_mode,
    extra_args: draft.extra_args,
    exclude_user_settings: draft.exclude_user_settings,
  };
}

export function hasProfileDraftChanges(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline) {
    return Boolean(
      current.name ||
      current.url ||
      current.key ||
      current.selectedModelId ||
      current.advancedModelMapping.enabled ||
      current.balanceSessionSelection !== "auto" ||
      current.balanceSessionDraft.label ||
      current.balanceSessionDraft.access_token ||
      current.balanceSessionDraft.user_id ||
      current.advancedModelMapping.claude?.defaultTarget ||
      current.advancedModelMapping.claude?.opusTarget ||
      current.advancedModelMapping.claude?.sonnetTarget ||
      current.advancedModelMapping.claude?.haikuTarget ||
      current.advancedModelMapping.claude?.subagentTarget ||
      current.advancedModelMapping.codex?.commandLineModelOverride ||
      current.cwd ||
      current.command_base ||
      current.settings_file ||
      current.extra_args ||
      current.launch_mode !== "new" ||
      current.exclude_user_settings !== true,
    );
  }

  return (
    current.name !== baseline.name ||
    current.url !== baseline.url ||
    current.key !== baseline.key ||
    current.selectedModelId !== baseline.selectedModelId ||
    JSON.stringify(current.advancedModelMapping) !== JSON.stringify(baseline.advancedModelMapping) ||
    current.balanceSessionSelection !== baseline.balanceSessionSelection ||
    JSON.stringify(current.balanceSessionDraft) !== JSON.stringify(baseline.balanceSessionDraft) ||
    current.cwd !== baseline.cwd ||
    current.command_base !== baseline.command_base ||
    current.settings_file !== baseline.settings_file ||
    current.launch_mode !== baseline.launch_mode ||
    current.extra_args !== baseline.extra_args ||
    current.exclude_user_settings !== baseline.exclude_user_settings
  );
}

export function hasOnlyProfileDraftCwdChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline || current.cwd === baseline.cwd) {
    return false;
  }

  return !hasProfileDraftChanges({ ...current, cwd: baseline.cwd }, baseline);
}

export function hasOnlyProfileDraftSelectedModelIdChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline || current.selectedModelId === baseline.selectedModelId) {
    return false;
  }

  return !hasProfileDraftChanges(
    { ...current, selectedModelId: baseline.selectedModelId },
    baseline,
  );
}

export function hasOnlyProfileDraftBalanceSessionChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (
    !baseline
    || (
      current.balanceSessionSelection === baseline.balanceSessionSelection
      && JSON.stringify(current.balanceSessionDraft) === JSON.stringify(baseline.balanceSessionDraft)
    )
  ) {
    return false;
  }

  return !hasProfileDraftChanges(
    {
      ...current,
      balanceSessionSelection: baseline.balanceSessionSelection,
      balanceSessionDraft: { ...baseline.balanceSessionDraft },
    },
    baseline,
  );
}

function cloneAdvancedModelMapping(value?: AdvancedModelMapping): AdvancedModelMapping {
  return {
    enabled: value?.enabled ?? false,
    claude: {
      defaultTarget: value?.claude?.defaultTarget ?? "",
      opusTarget: value?.claude?.opusTarget ?? "",
      sonnetTarget: value?.claude?.sonnetTarget ?? "",
      haikuTarget: value?.claude?.haikuTarget ?? "",
      subagentTarget: value?.claude?.subagentTarget ?? "",
    },
    codex: {
      commandLineModelOverride: value?.codex?.commandLineModelOverride ?? "",
    },
  };
}
