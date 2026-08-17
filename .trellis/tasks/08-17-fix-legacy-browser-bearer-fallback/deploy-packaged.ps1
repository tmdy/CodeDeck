$ErrorActionPreference = "Stop"

$workspaceRoot = [IO.Path]::GetFullPath("D:/CodeDeck")
$sourceDir = [IO.Path]::GetFullPath("D:/CodeDeck/release/win-unpacked")
$targetDir = [IO.Path]::GetFullPath("D:/CodeDeck/release-unified-codex-home/win-unpacked")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = [IO.Path]::GetFullPath("D:/CodeDeck/release-unified-codex-home/win-unpacked.backup-$stamp")
$failedDir = [IO.Path]::GetFullPath("D:/CodeDeck/release-unified-codex-home/win-unpacked.failed-$stamp")
$resultPath = [IO.Path]::GetFullPath(
  "D:/CodeDeck/.trellis/tasks/08-17-fix-legacy-browser-bearer-fallback/deployment-result.json"
)

function Write-Result {
  param(
    [string]$Status,
    [string]$Stage,
    [string]$Message = "",
    [string]$Hash = "",
    [int]$StartedPid = 0
  )
  @{
    status = $Status
    stage = $Stage
    message = $Message
    source = $sourceDir
    target = $targetDir
    backup = $backupDir
    app_asar_sha256 = $Hash
    started_pid = $StartedPid
    recorded_at = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

function Get-Sha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "")
    } finally {
      $algorithm.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

try {
  foreach ($path in @($sourceDir, $targetDir, $backupDir, $failedDir, $resultPath)) {
    if (-not $path.StartsWith($workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Path is outside the workspace: $path"
    }
  }
  if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
    throw "Source build directory does not exist: $sourceDir"
  }
  if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) {
    throw "Target directory does not exist: $targetDir"
  }
  $sourceHash = Get-Sha256 "$sourceDir/resources/app.asar"
  Write-Result -Status "running" -Stage "preflight" -Hash $sourceHash

  Start-Sleep -Seconds 5
  $owners = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "CodeDeck.exe" -and $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $targetDir,
      [StringComparison]::OrdinalIgnoreCase
    )
  })
  $children = @($owners | Where-Object { $_.ParentProcessId -in $owners.ProcessId })
  $roots = @($owners | Where-Object { $_.ParentProcessId -notin $owners.ProcessId })
  $children | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $roots | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 3

  $remaining = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "CodeDeck.exe" -and $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $targetDir,
      [StringComparison]::OrdinalIgnoreCase
    )
  })
  if ($remaining.Count -ne 0) {
    throw "Target CodeDeck processes are still running: $($remaining.ProcessId -join ',')"
  }
  Write-Result -Status "running" -Stage "stopped" -Hash $sourceHash

  Move-Item -LiteralPath $targetDir -Destination $backupDir
  try {
    Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse
    $targetHash = Get-Sha256 "$targetDir/resources/app.asar"
    if ($targetHash -ne $sourceHash) {
      throw "The deployed app.asar hash does not match the source build"
    }
  } catch {
    if (Test-Path -LiteralPath $targetDir) {
      Move-Item -LiteralPath $targetDir -Destination $failedDir
    }
    if (Test-Path -LiteralPath $backupDir) {
      Move-Item -LiteralPath $backupDir -Destination $targetDir
    }
    throw
  }

  $started = Start-Process -FilePath "$targetDir/CodeDeck.exe" `
    -WorkingDirectory $targetDir `
    -WindowStyle Hidden `
    -PassThru
  Write-Result `
    -Status "complete" `
    -Stage "started" `
    -Hash $sourceHash `
    -StartedPid $started.Id
} catch {
  Write-Result -Status "failed" -Stage "error" -Message $_.Exception.Message
  exit 1
}
