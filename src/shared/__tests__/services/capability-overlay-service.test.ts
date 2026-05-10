import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityOverlayService } from "../../services/capability-overlay-service.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skills-manager-capabilities-"));
  tempDirs.push(dir);
  return dir;
}

async function createSkill(root: string, name: string): Promise<string> {
  const skillPath = path.join(root, name);
  await mkdir(skillPath, { recursive: true });
  await writeFile(path.join(skillPath, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}\n`, "utf8");
  return skillPath;
}

describe("CapabilityOverlayService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("should create a Claude overlay from global MCP servers, standalone skills, and enabled plugins", async () => {
    const root = await makeTempDir();
    const claudeHome = path.join(root, ".claude");
    const overlayRoot = path.join(root, "app-data", "runtime-overlays");
    const pluginPath = path.join(claudeHome, "plugins", "cache", "market", "document-skills", "version");
    await mkdir(path.join(claudeHome, "skills"), { recursive: true });
    await mkdir(path.join(pluginPath, ".claude-plugin"), { recursive: true });
    await createSkill(path.join(claudeHome, "skills"), "workflow-plan");
    await writeFile(
      path.join(root, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          context7: { type: "stdio", command: "cmd", args: ["/c", "npx", "context7"], env: { API_KEY: "secret" } },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(claudeHome, "settings.json"),
      JSON.stringify({
        model: "opus",
        env: { SHOULD_NOT_COPY: "1" },
        permissions: { allow: ["Read", "mcp__context7__resolve-library-id"] },
        enabledPlugins: { "document-skills@anthropic-agent-skills": true },
      }),
      "utf8",
    );
    await writeFile(
      path.join(claudeHome, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "document-skills@anthropic-agent-skills": [{ scope: "user", installPath: pluginPath }],
        },
      }),
      "utf8",
    );
    await writeFile(path.join(pluginPath, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "ok" }), "utf8");

    const service = new CapabilityOverlayService({
      overlayRoot,
      claudeHome,
      claudeGlobalStatePath: path.join(root, ".claude.json"),
    });

    const overlay = await service.prepareClaudeOverlay({ profileId: "claude::demo" });

    expect(overlay.mcpConfigPaths).toEqual([path.join(overlayRoot, "claude", "claude__demo", "mcp-config.json")]);
    expect(overlay.addDirs).toEqual([path.join(overlayRoot, "claude", "claude__demo", "add-dir")]);
    expect(overlay.pluginDirs).toEqual([pluginPath]);
    expect(JSON.parse(await readFile(overlay.mcpConfigPaths[0], "utf8"))).toEqual({
      mcpServers: {
        context7: { type: "stdio", command: "cmd", args: ["/c", "npx", "context7"], env: { API_KEY: "secret" } },
      },
    });
    const settings = JSON.parse(await readFile(overlay.settingsFile, "utf8")) as Record<string, unknown>;
    expect(settings).toEqual({
      permissions: { allow: ["mcp__context7__resolve-library-id"] },
      enabledPlugins: { "document-skills@anthropic-agent-skills": true },
    });
    expect(await readFile(path.join(overlay.addDirs[0], ".claude", "skills", "workflow-plan", "SKILL.md"), "utf8"))
      .toContain("workflow-plan");
  });

  it("should create a Codex overlay with global MCP TOML and .agents skills links", async () => {
    const root = await makeTempDir();
    const codexHome = path.join(root, ".codex");
    const agentsHome = path.join(root, ".agents");
    const overlayRoot = path.join(root, "app-data", "runtime-overlays");
    const sharedHome = path.join(root, "app-data", "codex-runtime", "home");
    await mkdir(codexHome, { recursive: true });
    await createSkill(path.join(agentsHome, "skills"), "codex-review");
    await createSkill(path.join(codexHome, "superpowers", "skills"), "using-superpowers");
    await writeFile(
      path.join(codexHome, "config.toml"),
      '[mcp_servers]\n\n[mcp_servers.playwright]\ncommand = "cmd"\nargs = ["/c", "npx", "@playwright/mcp@latest"]\nenv = { SYSTEMROOT = "C:/WINDOWS" }\n',
      "utf8",
    );

    const service = new CapabilityOverlayService({
      overlayRoot,
      codexHome,
      agentsHome,
    });

    const overlay = await service.prepareCodexOverlay({ profileId: "codex::demo", profileHome: sharedHome });

    expect(overlay.globalMcpToml).toContain("[mcp_servers.playwright]");
    expect(overlay.globalMcpToml).toContain('command = "cmd"');
    expect(await readFile(path.join(overlayRoot, "codex", "codex-profile-fa5cae70e79192f1", "manifest.json"), "utf8"))
      .toContain("codex::demo");
    expect(overlay.skillLinks.map((item) => path.basename(item.targetPath)).sort()).toEqual([
      "codex-review",
      "using-superpowers",
    ]);
    expect(await readFile(path.join(sharedHome, ".agents", "skills", "codex-review", "SKILL.md"), "utf8"))
      .toContain("codex-review");
    expect(overlay.skillLinks.every((item) => item.targetPath.includes("codex-runtime"))).toBe(true);
  });

  it("should refuse to clear an overlay outside the configured overlay root", async () => {
    const root = await makeTempDir();
    const service = new CapabilityOverlayService({ overlayRoot: path.join(root, "overlays") });

    await expect(service.clearManagedOverlay(path.join(root, "not-overlays"))).rejects.toThrow("拒绝清理 overlay 根目录之外的路径");
  });

  it("should preserve symlinked Codex skills as supported skill sources", async () => {
    const root = await makeTempDir();
    const sourceRoot = path.join(root, "source-skills");
    const agentsHome = path.join(root, ".agents");
    await createSkill(sourceRoot, "linked-skill");
    await mkdir(path.join(agentsHome, "skills"), { recursive: true });
    await symlink(path.join(sourceRoot, "linked-skill"), path.join(agentsHome, "skills", "linked-skill"), "junction");
    const profileHome = path.join(root, "app-data", "codex-runtime", "home");

    const service = new CapabilityOverlayService({
      overlayRoot: path.join(root, "overlays"),
      agentsHome,
      codexHome: path.join(root, ".codex-empty"),
    });

    const overlay = await service.prepareCodexOverlay({ profileId: "codex::linked", profileHome });

    expect(overlay.skillLinks).toEqual([
      expect.objectContaining({ skillName: "linked-skill" }),
    ]);
    expect(await readFile(path.join(profileHome, ".agents", "skills", "linked-skill", "SKILL.md"), "utf8"))
      .toContain("linked-skill");
  });
});
