[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("profiles", "run", "continue", "status", "wait", "cancel")]
  [string]$Command,
  [string]$Profile,
  [string]$Session,
  [string]$Cwd,
  [int]$WaitMs = -1,
  [switch]$ShowTerminal,
  [string]$Prompt
)

$ErrorActionPreference = "Stop"

if ($env:CODEDECK_DELEGATED -eq "1") {
  throw "Delegated CodeDeck sessions cannot delegate recursively."
}

$agent = Get-Command "codedeck-agent.cmd" -ErrorAction SilentlyContinue
$agentPath = if ($env:CODEDECK_AGENT_CLI) {
  $env:CODEDECK_AGENT_CLI
} elseif ($agent) {
  $agent.Source
} else {
  $null
}

if (-not $agentPath) {
  $installCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\CodeDeck\codedeck-agent.cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\codedeck\codedeck-agent.cmd")
  )
  $agentPath = $installCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}

$repoCli = Join-Path $PSScriptRoot "..\..\..\dist-electron\electron\agent-cli.js"
$useRepoCli = -not $agentPath -and (Test-Path -LiteralPath $repoCli)
if (-not $agentPath -and -not $useRepoCli) {
  throw "codedeck-agent was not found. Install/build CodeDeck and keep it running."
}

$agentArgs = @($Command)
if ($Profile) {
  $agentArgs += @("--profile", $Profile)
}
if ($Session) {
  $agentArgs += @("--session", $Session)
}
if ($Cwd) {
  $agentArgs += @("--cwd", $Cwd)
}
if ($WaitMs -ge 0) {
  $agentArgs += @("--wait-ms", [string]$WaitMs)
}
if ($ShowTerminal) {
  $agentArgs += "--show-terminal"
}

$requiresPrompt = $Command -eq "run" -or $Command -eq "continue"
if ($requiresPrompt -and [string]::IsNullOrWhiteSpace($Prompt)) {
  throw "$Command requires -Prompt."
}

if ($useRepoCli) {
  if ($requiresPrompt) {
    $raw = $Prompt | & node $repoCli @agentArgs
  } else {
    $raw = & node $repoCli @agentArgs
  }
} else {
  if ($requiresPrompt) {
    $raw = $Prompt | & $agentPath @agentArgs
  } else {
    $raw = & $agentPath @agentArgs
  }
}

$exitCode = $LASTEXITCODE
$json = $raw -join [Environment]::NewLine
try {
  $null = $json | ConvertFrom-Json
} catch {
  throw "codedeck-agent returned invalid JSON: $json"
}
$json
exit $exitCode
