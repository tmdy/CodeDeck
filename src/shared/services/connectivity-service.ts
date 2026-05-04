// 连接测试服务

import type { ConnectivityResult } from "../connectivity/types.js";

export async function testClaudeConnectivity(
  commandBase: string,
  settingsFile: string,
  timeoutMs: number = 120000,
): Promise<ConnectivityResult> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const cmd = `${commandBase || "claude"} --settings "${settingsFile}" -p "ping"`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
    return {
      success: stdout.includes("1") || stdout.length > 0,
      message: "连接成功",
      command_used: cmd,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "连接失败",
      command_used: cmd,
    };
  }
}

export async function testCodexConnectivity(
  commandBase: string,
  _baseUrl: string,
  timeoutMs: number = 120000,
): Promise<ConnectivityResult> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  // Codex 通过 request.js 输出文件检查连接
  const cmd = `${commandBase || "codex"} exec --no-sandbox --timeout ${Math.floor(timeoutMs / 1000)} -p "测试连接"`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
    return {
      success: stdout.length > 0,
      message: "连接成功",
      command_used: cmd,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "连接失败",
      command_used: cmd,
    };
  }
}