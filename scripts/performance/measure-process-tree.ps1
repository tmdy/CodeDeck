param(
  [Parameter(Mandatory = $true)][int]$RootProcessId,
  [ValidateRange(1, 86400)][int]$DurationSeconds = 30,
  [ValidateRange(250, 60000)][int]$IntervalMilliseconds = 1000,
  [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$samples = [System.Collections.Generic.List[object]]::new()
$previous = @{}
$logicalCpus = [Environment]::ProcessorCount
$watch = [Diagnostics.Stopwatch]::StartNew()
$startedAt = [DateTime]::UtcNow.ToString('o')
$rootIdentity = $null

while ($watch.Elapsed.TotalSeconds -lt $DurationSeconds) {
  $sampleStarted = $watch.Elapsed.TotalSeconds
  $inventory = @(Get-CimInstance Win32_Process)
  $rootProcess = $inventory | Where-Object ProcessId -eq $RootProcessId | Select-Object -First 1
  if (-not $rootProcess) { break }
  if ($null -eq $rootIdentity) {
    $rootIdentity = [pscustomobject]@{ executable = $rootProcess.ExecutablePath; created = $rootProcess.CreationDate }
  }
  if ($rootProcess.CreationDate -ne $rootIdentity.created) { throw 'Root PID was reused; refusing to sample a different application.' }
  $descendants = [System.Collections.Generic.HashSet[int]]::new()
  [void]$descendants.Add($RootProcessId)
  do {
    $changed = $false
    foreach ($candidate in $inventory) {
      if ($descendants.Contains([int]$candidate.ParentProcessId) -and $candidate.CreationDate -ge $rootIdentity.created) {
        if ($descendants.Add([int]$candidate.ProcessId)) { $changed = $true }
      }
    }
  } while ($changed)
  $nowSeconds = $watch.Elapsed.TotalSeconds
  foreach ($candidate in $inventory) {
    if (-not $descendants.Contains([int]$candidate.ProcessId)) { continue }
    # CommandLine is used only to classify Electron roles; never serialize credentials or command arguments.
    $role = 'external_cli_or_shell'
    $group = 'external'
    if ($candidate.CommandLine -match '[\\/]conpty_console_list_agent(?:\.js)?(?:["\s]|$)') {
      $group = 'pty_support'; $role = 'conpty_console_list_agent'
    } elseif ($candidate.ExecutablePath -and $candidate.ExecutablePath -eq $rootIdentity.executable) {
      $group = 'codedeck'
      $role = if ($candidate.ProcessId -eq $RootProcessId) { 'main' } elseif ($candidate.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { 'electron_auxiliary_unknown' }
    } elseif ($candidate.Name -match '^(conhost|OpenConsole|winpty-agent)\.exe$') {
      $group = 'pty_support'; $role = $candidate.Name
    }
    $identity = '{0}:{1:o}' -f $candidate.ProcessId, $candidate.CreationDate
    $cpuSeconds = ([double]$candidate.KernelModeTime + [double]$candidate.UserModeTime) / 10000000
    $cpuOneCore = $null; $readDelta = $null; $writeDelta = $null
    if ($previous.ContainsKey($identity)) {
      $last = $previous[$identity]
      $elapsed = $nowSeconds - $last.time
      if ($elapsed -gt 0) { $cpuOneCore = 100 * [math]::Max(0, $cpuSeconds - $last.cpu) / $elapsed }
      $readDelta = [math]::Max(0, [double]$candidate.ReadTransferCount - $last.read)
      $writeDelta = [math]::Max(0, [double]$candidate.WriteTransferCount - $last.write)
    }
    $samples.Add([pscustomobject]@{
      elapsedSeconds = $nowSeconds; timestampUtc = [DateTime]::UtcNow.ToString('o'); id = $candidate.ProcessId; parentId = $candidate.ParentProcessId
      name = $candidate.Name; group = $group; role = $role
      workingSetBytes = [double]$candidate.WorkingSetSize; privateCommitBytes = [double]$candidate.PrivatePageCount
      cpuOneCorePercent = $cpuOneCore
      cpuMachinePercent = if ($null -ne $cpuOneCore) { $cpuOneCore / $logicalCpus } else { $null }
      readTransferBytesDelta = $readDelta; writeTransferBytesDelta = $writeDelta
      handles = $candidate.HandleCount; threads = $candidate.ThreadCount
    })
    $previous[$identity] = @{ time = $nowSeconds; cpu = $cpuSeconds; read = [double]$candidate.ReadTransferCount; write = [double]$candidate.WriteTransferCount }
  }
  $remaining = $IntervalMilliseconds - ($watch.Elapsed.TotalSeconds - $sampleStarted) * 1000
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]$remaining) }
}
if ($samples.Count -eq 0) { throw 'No samples collected. Check the CodeDeck main process PID.' }
$targetPath = [IO.Path]::GetFullPath($OutputPath)
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetPath))
$report = [ordered]@{
  schemaVersion = 1; startedAt = $startedAt; measuredAt = [DateTime]::UtcNow.ToString('o'); rootProcessId = $RootProcessId
  rootExecutable = $rootIdentity.executable; logicalCpus = $logicalCpus
  note = 'Read-only CIM sampling. Summed working sets can count shared pages repeatedly. Transfer counters include non-disk I/O. ConPTY agents are separate even when they use the Electron executable. Unknown descendants are external, not CodeDeck. CPU uses measured elapsed time; first sample has no delta.'
  samples = @($samples.ToArray())
}
[IO.File]::WriteAllText($targetPath, ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Output $targetPath
