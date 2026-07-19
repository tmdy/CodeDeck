import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("Electron main node-pty loading", () => {
  it("defers loading node-pty until a monitored terminal session is launched", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));

    expect(source).not.toMatch(/import\s+\*\s+as\s+nodePty\s+from\s+["']node-pty["'];/);
    expect(source).toContain('type NodePtyModule = typeof import("node-pty");');
    expect(source).toContain("async function ensureNodePtyLoaded(): Promise<NodePtyModule>");

    const launchStart = source.indexOf("async function launchMonitoredTerminalSession");
    const launchEnd = source.indexOf("async function prepareCapabilityOverlay", launchStart);
    const launchBlock = source.slice(launchStart, launchEnd);
    const validateIndex = launchBlock.indexOf("await validateLaunchPlan(plan);");
    const loadIndex = launchBlock.indexOf("await ensureNodePtyLoaded();");
    const createSessionIndex = launchBlock.indexOf("terminalSessionManager.createSession");

    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(loadIndex).toBeGreaterThan(validateIndex);
    expect(loadIndex).toBeLessThan(createSessionIndex);

    const createPtyStart = source.indexOf("function createNodePtyProcess");
    const createPtyEnd = source.indexOf("function getTerminalAttachmentKey", createPtyStart);
    const createPtyBlock = source.slice(createPtyStart, createPtyEnd);

    expect(createPtyBlock).toContain("if (!nodePtyModule)");
    expect(createPtyBlock).toContain("nodePtyModule.spawn");
  });
});
