import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CodexProviderResumeRepairPlan } from "../services/codex-provider-resume-repair.js";

// Keep verification and append on one Windows handle which denies other writers.
const APPEND_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$stream = $null
$writing = $false
try {
  $stream = [IO.FileStream]::new($request.filePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
  if ($stream.Length -ne $request.originalSize) { throw 'session_changed' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  if ($hash -ne $request.originalSha256) { throw 'session_changed' }
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($request.appendText)
  $stream.Position = $request.originalSize
  $writing = $true
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush($true)
  $writing = $false
  [Console]::Out.Write('ok')
} catch {
  if ($writing -and $null -ne $stream) {
    $stream.SetLength($request.originalSize)
    $stream.Flush($true)
  }
  [Console]::Error.Write('session_busy_or_changed')
  exit 1
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
`;

export async function appendCodexResumeRepairExclusively(
  plan: CodexProviderResumeRepairPlan,
  recoveryDirectory: string,
): Promise<void> {
  await fs.mkdir(recoveryDirectory, { recursive: true });
  const manifestPath = path.join(recoveryDirectory, `${plan.sessionId}-${randomUUID()}.json`);
  const manifest = {
    sessionId: plan.sessionId,
    filePath: plan.filePath,
    originalSize: plan.originalSize,
    originalSha256: plan.originalSha256,
    appendSha256: plan.appendSha256,
    appendBytes: Buffer.byteLength(plan.appendText, "utf8"),
    removedReasoningItems: plan.removedReasoningItems,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(APPEND_SCRIPT, "utf16le").toString("base64"),
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.resume();
    child.stdin.on("error", () => { /* The close/error event below reports the result. */ });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && output === "ok") resolve();
      else reject(new Error("会话正在使用或已发生变化，请退出该会话的 Codex 终端后重试。原历史未被替换。"));
    });
    child.stdin.end(JSON.stringify({
      filePath: plan.filePath,
      originalSize: plan.originalSize,
      originalSha256: plan.originalSha256,
      appendText: plan.appendText,
    }));
  });
  // Pending metadata still suffices for recovery if this final audit update fails.
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, status: "applied" }, null, 2));
}
