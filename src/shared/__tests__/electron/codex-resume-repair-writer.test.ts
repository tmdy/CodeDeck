import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { appendCodexResumeRepairExclusively } from "../../electron/codex-resume-repair-writer.js";
import type { CodexProviderResumeRepairPlan } from "../../services/codex-provider-resume-repair.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codedeck-repair-writer-"));
  roots.push(root);
  const filePath = path.join(root, "session.jsonl");
  const original = Buffer.from('{"text":"保留原始历史"}\n', "utf8");
  const appendText = '{"type":"compacted","payload":{"message":"保留中文与非 ASCII 内容：继续 🌟 café"}}\n';
  await fs.writeFile(filePath, original);
  const stat = await fs.stat(filePath);
  const plan: CodexProviderResumeRepairPlan = {
    filePath, sessionId: "test-session", targetProvider: "openai_http",
    originalSize: original.length, originalMtimeMs: stat.mtimeMs,
    originalSha256: createHash("sha256").update(original).digest("hex"),
    appendText, appendSha256: createHash("sha256").update(appendText).digest("hex"),
    removedReasoningItems: 1, preservedHistoryItems: 2, sourceProviders: ["site_test"],
  };
  return { root, plan, original };
}

describe("exclusive Codex repair writer", () => {
  it("preserves every original byte and writes a recovery manifest", async () => {
    const { root, plan, original } = await fixture();
    const recovery = path.join(root, "recovery");
    await appendCodexResumeRepairExclusively(plan, recovery);
    expect(await fs.readFile(plan.filePath)).toEqual(Buffer.concat([original, Buffer.from(plan.appendText)]));
    const [entry] = await fs.readdir(recovery);
    const manifest = JSON.parse(await fs.readFile(path.join(recovery, entry), "utf8"));
    expect(manifest).toMatchObject({ status: "applied", originalSize: original.length, originalSha256: plan.originalSha256 });
    expect(manifest).not.toHaveProperty("appendText");
  }, 15_000);

  it("rejects changed content even when the file length is unchanged", async () => {
    const { root, plan, original } = await fixture();
    const changed = Buffer.from(original);
    changed[1] = 32;
    await fs.writeFile(plan.filePath, changed);
    await expect(appendCodexResumeRepairExclusively(plan, path.join(root, "recovery"))).rejects.toThrow("发生变化");
    expect(await fs.readFile(plan.filePath)).toEqual(changed);
  }, 15_000);

  it("rejects an existing writer without changing its session bytes", async () => {
    const { root, plan, original } = await fixture();
    const script = `
$ErrorActionPreference = 'Stop'
$filePath = [Console]::In.ReadLine()
$stream = [IO.FileStream]::new($filePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
try {
  [Console]::Out.Write('ready')
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
} finally { $stream.Dispose() }
`;
    const holder = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<void>((resolve) => { holder.once("close", () => resolve()); });
    holder.stderr.resume();
    holder.stdin.on("error", () => { /* Startup/close below reports holder failures. */ });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        holder.once("error", reject);
        holder.once("close", () => reject(new Error("Fixture writer exited before releasing its handle")));
        holder.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (output === "ready") resolve();
        });
        holder.stdin.write(`${plan.filePath}\n`);
      });
      await expect(appendCodexResumeRepairExclusively(plan, path.join(root, "recovery"))).rejects.toThrow("正在使用");
      expect(await fs.readFile(plan.filePath)).toEqual(original);
    } finally {
      holder.stdin.end("release\n");
      await closed;
    }
    // The same plan remains usable once the real writer releases its handle.
    await appendCodexResumeRepairExclusively(plan, path.join(root, "recovery"));
    expect(await fs.readFile(plan.filePath)).toEqual(Buffer.concat([original, Buffer.from(plan.appendText)]));
  }, 30_000);
});
