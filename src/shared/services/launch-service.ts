// 启动服务 — 命令预览和终端启动编排

import type { Profile } from "../profile/types.js";
import type { RuntimeSettings } from "../profile/types.js";
import type { LaunchRequest, CommandPreview } from "../launcher/types.js";
import { getAdapter } from "../provider/registry.js";
import type { ProfileService } from "./profile-service.js";

export class LaunchService {
  constructor(private profileService: ProfileService) {}

  /**
   * 根据 profile 和 runtime 生成命令预览
   */
  buildPreview(profile: Profile, runtime: RuntimeSettings): CommandPreview {
    try {
      const adapter = getAdapter(profile.provider);
      const command = adapter.buildCommand({
        commandBase: runtime.command_base,
        launchMode: runtime.launch_mode,
        extraArgs: runtime.extra_args,
        excludeUserSettings: runtime.exclude_user_settings,
        baseUrl: profile.url,
        model: runtime.model,
      });
      return { command, valid: true };
    } catch {
      return { command: "", valid: false };
    }
  }

  /**
   * 为请求生成命令预览
   */
  previewForRequest(request: LaunchRequest): CommandPreview {
    const profiles = this.profileService.getProfiles();
    const profile = profiles.find((p) => {
      const { buildKey } = require("../profile/keys-internal.js");
      return buildKey(p.provider, p.name) === request.profile_key;
    });

    if (!profile) {
      return { command: "", valid: false };
    }

    return this.buildPreview(profile, request.runtime_settings);
  }
}