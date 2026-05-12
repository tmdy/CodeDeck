$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$npmCmd = "C:/Program Files/nodejs/npm.cmd"
$port = 5173
$logPath = Join-Path $projectRoot "app-data/launch-dev-hidden.log"
$devOutLog = Join-Path $projectRoot "app-data/npm-run-dev.out.log"
$devErrLog = Join-Path $projectRoot "app-data/npm-run-dev.err.log"

function Write-LaunchLog {
  param([string]$Message)

  $directory = Split-Path -Parent $logPath
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  Add-Content -LiteralPath $logPath -Value "[$((Get-Date).ToString('s'))] $Message"
}

function Test-PortListening {
  param([int]$LocalPort)
  return [bool](Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
}

function Stop-WorkspaceProcesses {
  $escapedProjectRoot = $projectRoot.Replace("\", "\\")
  $targets = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and
    $_.Name -in @("node.exe", "electron.exe", "cmd.exe", "Skills Manager.exe") -and
    $_.CommandLine -and
    (
      $_.CommandLine -like "*$projectRoot*" -or
      $_.CommandLine -like "*$escapedProjectRoot*" -or
      $_.CommandLine -like "*skills管理*" -or
      $_.CommandLine -like "*vite.js --port $port*" -or
      $_.CommandLine -like "*concurrently*"
    )
  }

  Write-LaunchLog "stop related processes: $($targets.Count)"
  foreach ($process in $targets) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-LaunchLog "stopped $($process.Name) $($process.ProcessId)"
    } catch {
      Write-LaunchLog "failed to stop $($process.Name) $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Test-WorkspaceElectronRunning {
  $escapedProjectRoot = $projectRoot.Replace("\", "\\")
  return [bool](Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "electron.exe" -and
    $_.CommandLine -and
    (
      $_.CommandLine -like "*$projectRoot*" -or
      $_.CommandLine -like "*$escapedProjectRoot*" -or
      $_.CommandLine -like "*skills管理*"
    )
  } | Select-Object -First 1)
}

Write-LaunchLog "start"
Stop-WorkspaceProcesses

Remove-Item -LiteralPath $devOutLog, $devErrLog -Force -ErrorAction SilentlyContinue

Write-LaunchLog "start npm run dev"
Start-Process `
  -FilePath $npmCmd `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $devOutLog `
  -RedirectStandardError $devErrLog

$deadline = (Get-Date).AddSeconds(35)
while ((Get-Date) -lt $deadline) {
  if ((Test-PortListening -LocalPort $port) -and (Test-WorkspaceElectronRunning)) {
    Write-LaunchLog "ready"
    return
  }
  Start-Sleep -Milliseconds 500
}

Write-LaunchLog "timeout waiting for npm run dev readiness"
if (Test-Path -LiteralPath $devErrLog) {
  $errorTail = Get-Content -LiteralPath $devErrLog -Tail 20 -ErrorAction SilentlyContinue
  foreach ($line in $errorTail) {
    Write-LaunchLog "stderr: $line"
  }
}
