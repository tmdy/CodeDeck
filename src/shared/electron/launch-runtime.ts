import type { LaunchExecutionPlan } from "../services/launch-service.js";

export interface ExternalTerminalLaunchSpec {
  filePath: string;
  args: string[];
  cwd: string;
}

export interface LaunchRuntimeDependencies {
  directoryExists: (cwd: string) => Promise<boolean>;
  commandExists: (commandBase: string) => Promise<boolean>;
  spawnExternalTerminal: (spec: ExternalTerminalLaunchSpec) => Promise<void>;
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractExecutableName(commandBase: string): string {
  const trimmed = commandBase.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("\"")) {
    const endIndex = trimmed.indexOf("\"", 1);
    return endIndex > 1 ? trimmed.slice(1, endIndex) : trimmed.slice(1);
  }
  if (trimmed.startsWith("'")) {
    const endIndex = trimmed.indexOf("'", 1);
    return endIndex > 1 ? trimmed.slice(1, endIndex) : trimmed.slice(1);
  }
  const [firstToken] = trimmed.split(/\s+/, 1);
  return firstToken ?? "";
}

function buildPowerShellSessionScript(plan: LaunchExecutionPlan): string {
  const envLines = Object.entries(plan.env).map(([name, value]) => `$env:${name} = ${toPowerShellLiteral(value)}`);
  const commandArgsJson = JSON.stringify(plan.commandArgs);
  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${toPowerShellLiteral(plan.cwd)}`,
    ...envLines,
    `$commandArgs = @((ConvertFrom-Json ${toPowerShellLiteral(commandArgsJson)}))`,
    `& ${toPowerShellLiteral(plan.commandExecutable)} @commandArgs`,
  ].join("; ");
}

export function buildWindowsExternalTerminalLaunchSpec(plan: LaunchExecutionPlan): ExternalTerminalLaunchSpec {
  const encodedCommand = Buffer.from(buildPowerShellSessionScript(plan), "utf16le").toString("base64");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$arguments = @('-NoExit', '-EncodedCommand', ${toPowerShellLiteral(encodedCommand)})`,
    `Start-Process -FilePath 'powershell.exe' -WorkingDirectory ${toPowerShellLiteral(plan.cwd)} -ArgumentList $arguments -WindowStyle Normal`,
  ].join("; ");

  return {
    filePath: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    cwd: plan.cwd,
  };
}

export async function executeLaunchPlan(
  plan: LaunchExecutionPlan,
  dependencies: LaunchRuntimeDependencies,
): Promise<void> {
  if (!plan.valid) {
    throw new Error(plan.error || "无法生成启动命令。");
  }
  if (!plan.cwd.trim() || !(await dependencies.directoryExists(plan.cwd))) {
    throw new Error("工作目录不存在，请先设置有效的工作目录。");
  }
  if (plan.launchMode === "resume_selected" && !(plan.sessionId ?? "").trim()) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }
  for (const envKey of plan.requiredEnvKeys) {
    if (!(plan.env[envKey] ?? "").trim()) {
      throw new Error(`Provider 配置缺少必需环境变量：${envKey}`);
    }
  }

  const executableName = extractExecutableName(plan.commandExecutable);
  if (!executableName || !(await dependencies.commandExists(executableName))) {
    throw new Error(`命令不可执行或不在 PATH 中：${executableName || plan.commandExecutable}`);
  }

  await dependencies.spawnExternalTerminal(buildWindowsExternalTerminalLaunchSpec(plan));
}
