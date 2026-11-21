$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Windows PowerShell 5.1 can inherit PSModulePath from PowerShell 7 (GitHub Actions).
# Load built-in modules by absolute path if automatic discovery is unavailable.
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
}
if (-not (Get-Command Expand-Archive -ErrorAction SilentlyContinue)) {
  $archiveModule = Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1'
  if (Test-Path -LiteralPath $archiveModule) { Import-Module $archiveModule -ErrorAction Stop }
}

$project = $PSScriptRoot
$runtime = Join-Path $project '09-Окружение'
$data = Join-Path $project '06-Данные'
$log = Join-Path $data 'журнал-окружения.log'
$nodeVersion = '24.21.0'
$pythonVersion = '3.13.17'
$pythonHash = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'
$nodeArchive = "node-v$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchive"
$nodeShas = "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt"
$pythonArchive = "python-$pythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/$pythonArchive"
$nodeFolder = Join-Path $runtime 'Нода'
$pythonFolder = Join-Path $runtime 'Пайтон'
$nodeExe = Join-Path $nodeFolder 'node.exe'
$pythonExe = Join-Path $pythonFolder 'python.exe'
$startupLock = Join-Path $runtime 'загрузка.lock'
$script:lockOwned = $false
New-Item -ItemType Directory -Force -Path $runtime, $data | Out-Null

function Clean-Message([string]$msg) {
  # Avoid logging user-provided secrets, HTTP headers or PowerShell error records.
  return ($msg -replace '(?i)(bearer\s+)[^\s]+', '$1[REDACTED]' -replace '(?i)(CLOUD_RU_API_KEY\s*[=:]\s*)[^\s]+', '$1[REDACTED]')
}
function Write-Log([string]$msg) {
  $line = "[$([DateTime]::UtcNow.ToString('o'))] " + (Clean-Message $msg)
  if (Test-Path -LiteralPath $log) {
    if ((Get-Item -LiteralPath $log).Length -gt 2097152) {
      for ($i = 3; $i -ge 1; $i--) {
        $from = if ($i -eq 1) { $log } else { "$log.$($i - 1)" }
        $to = "$log.$i"
        if (Test-Path -LiteralPath $from) { Move-Item -LiteralPath $from -Destination $to -Force }
      }
    }
  }
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function Classify-Error([System.Exception]$error) {
  if ($error -is [System.UnauthorizedAccessException]) { return 'ACCESS_DENIED (permissions or security policy)' }
  if ($error -is [System.Net.WebException]) { return 'NETWORK (internet, proxy or TLS)' }
  if ($error -is [System.IO.IOException]) {
    $nativeCode = ($error.HResult -band 0xFFFF)
    if ($nativeCode -eq 112 -or $nativeCode -eq 39) { return 'DISK_FULL' }
    if ($nativeCode -eq 5 -or $nativeCode -eq 32) { return 'FILE_ACCESS (locked file, permissions or antivirus)' }
    return 'FILE_IO (drive, filesystem or removable device)'
  }
  if ($error.Message -match 'SHA-256|integrity|checksum') { return 'INTEGRITY' }
  if ($error.Message -match 'Missing|not found') { return 'MISSING_FILE' }
  return 'UNKNOWN (see diagnostics)'
}
function Stage([string]$msg) {
  Write-Host ("[Kiyomira] " + $msg) -ForegroundColor Cyan
  Write-Log $msg
}
function Assert-Write([string]$folder) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $test = Join-Path $folder ("проверка-" + [guid]::NewGuid().ToString('N'))
  try { [IO.File]::WriteAllText($test, 'ok') }
  finally { Remove-Item -LiteralPath $test -Force -ErrorAction SilentlyContinue }
}
function Take-Lock {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      $stream = New-Object IO.FileStream($startupLock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(([string]$PID))
        $stream.Write($bytes, 0, $bytes.Length)
      } finally { $stream.Dispose() }
      $script:lockOwned = $true
      return
    } catch [System.IO.IOException] {
      if (-not (Test-Path -LiteralPath $startupLock)) { continue }
      $pidText = $null
      try { $pidText = [IO.File]::ReadAllText($startupLock) } catch {}
      $otherPid = 0
      if ([int]::TryParse($pidText, [ref]$otherPid) -and $otherPid -gt 0) {
        if (Get-Process -Id $otherPid -ErrorAction SilentlyContinue) { throw 'Another Kiyomira environment setup is in progress' }
      } elseif (([DateTime]::UtcNow - (Get-Item -LiteralPath $startupLock).LastWriteTimeUtc).TotalSeconds -lt 30) {
        throw 'Environment setup lock is recent; retry shortly'
      }
      Remove-Item -LiteralPath $startupLock -Force -ErrorAction Stop
    }
  }
  throw 'Unable to obtain environment setup lock'
}
function Fetch([string]$url, [string]$file) {
  if ($env:KIYOMIRA_OFFLINE -eq '1') { throw 'Offline mode: download is disabled' }
  $hostName = ([uri]$url).Host
  if (([uri]$url).Scheme -ne 'https' -or $hostName -notin @('nodejs.org','www.python.org')) { throw 'Download host not approved' }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -MaximumRedirection 2 -TimeoutSec 90
      if ((Get-Item -LiteralPath $file).Length -le 0) { throw 'Empty download' }
      return
    } catch {
      Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
      if ($attempt -eq 3) { throw "Download failed after 3 attempts ($hostName)" }
      Start-Sleep -Seconds (2 * $attempt)
    }
  }
}
function Fingerprint([string]$folder) {
  $entries = @()
  Get-ChildItem -LiteralPath $folder -Recurse -File | Where-Object { $_.Name -ne 'проверка-файлов.json' } | ForEach-Object {
    $relative = $_.FullName.Substring($folder.Length).TrimStart([char]92,[char]47)
    $entries += [pscustomobject]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  if ($entries.Count -lt 1) { throw 'Runtime folder is empty' }
  $fingerprints = @{ files = $entries } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path $folder 'проверка-файлов.json'), $fingerprints, (New-Object Text.UTF8Encoding($false)))
}
function Verify-Files([string]$folder) {
  $manifest = Join-Path $folder 'проверка-файлов.json'
  if (-not (Test-Path -LiteralPath $manifest)) { return $false }
  try {
    $info = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $count = 0
    foreach ($item in $info.files) {
      $relative = [string]$item.path
      if ([IO.Path]::IsPathRooted($relative) -or ($relative -split '[\\/]') -contains '..') { return $false }
      $file = Join-Path $folder $relative
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
      if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne [string]$item.sha256) { return $false }
      $count++
    }
    return ($count -ge 1)
  } catch { return $false }
}
function Install-Package([string]$url,[string]$hash,[string]$destination,[string]$mode,[string]$version) {
  $temp = Join-Path $runtime ('загрузка-' + [guid]::NewGuid().ToString('N'))
  $unpack = Join-Path $temp 'распаковано'
  $old = "$destination.резерв"
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    $zip = Join-Path $temp 'архив.zip'
    Fetch $url $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $hash) { throw 'Archive SHA-256 does not match trusted manifest' }
    Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
    $source = if ($mode -eq 'node') { Join-Path $unpack "node-v$version-win-x64" } else { $unpack }
    $exe = if ($mode -eq 'node') { 'node.exe' } else { 'python.exe' }
    if (-not (Test-Path -LiteralPath (Join-Path $source $exe))) { throw 'Runtime executable missing in archive' }
    Fingerprint $source
    if (-not (Verify-Files $source)) { throw 'Runtime integrity check failed before activation' }
    # Keep the previous reserve until the new executable has passed all checks.
    $older = "$destination.резерв-предыдущий"
    if ((Test-Path -LiteralPath $older) -and (Test-Path -LiteralPath $old)) {
      throw 'Two existing backups: manual review required before update'
    }
    $movedOlder = $false
    $movedCurrent = $false
    try {
      if (Test-Path -LiteralPath $old) {
        Move-Item -LiteralPath $old -Destination $older
        $movedOlder = $true
      }
      if (Test-Path -LiteralPath $destination) {
        Move-Item -LiteralPath $destination -Destination $old
        $movedCurrent = $true
      }
      Move-Item -LiteralPath $source -Destination $destination
      $output = (& (Join-Path $destination $exe) --version 2>&1 | Out-String).Trim()
      $expected = if ($mode -eq 'node') { "v$version" } else { "Python $version" }
      if ($LASTEXITCODE -ne 0 -or $output -ne $expected -or -not (Verify-Files $destination)) {
        throw 'New runtime failed validation'
      }
    } catch {
      if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
      }
      if ($movedCurrent -and (Test-Path -LiteralPath $old)) {
        Move-Item -LiteralPath $old -Destination $destination
      }
      if ($movedOlder -and (Test-Path -LiteralPath $older)) {
        Move-Item -LiteralPath $older -Destination $old
      }
      throw
    }
    # After validation, the latest previous runtime is in .резерв.
    # Only now may an older reserve be removed.
    if (Test-Path -LiteralPath $older) {
      Remove-Item -LiteralPath $older -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Log ("Activated $mode $version")
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
function Restore-Runtime([string]$folder,[string]$exe,[string]$version) {
  $old = "$folder.резерв"
  if (-not (Test-Path -LiteralPath $old)) { return $false }
  if (-not (Verify-Files $old)) { return $false }
  $exeName = Split-Path -Path $exe -Leaf
  $output = (& (Join-Path $old $exeName) --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $output -ne $version) { return $false }
  $broken = "$folder.повреждено"
  if (Test-Path -LiteralPath $broken) { return $false }
  if (Test-Path -LiteralPath $folder) { Move-Item -LiteralPath $folder -Destination $broken }
  Move-Item -LiteralPath $old -Destination $folder
  Stage 'Recovered previous verified runtime without network'
  return $true
}
function Ensure-Node {
  if ((Test-Path -LiteralPath $nodeExe) -and (Verify-Files $nodeFolder)) {
    if ((& $nodeExe --version) -eq "v$nodeVersion") { Stage 'Node.js is ready (offline)'; return }
  }
  if (Restore-Runtime $nodeFolder $nodeExe "v$nodeVersion") { return }
  Stage 'Node.js missing or corrupt: recovering verified runtime'
  $manifest = Join-Path $runtime ('manifest-' + [guid]::NewGuid().ToString('N'))
  try {
    Fetch $nodeShas $manifest
    $line = Get-Content -LiteralPath $manifest | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+' + [regex]::Escape($nodeArchive) + '$') } | Select-Object -First 1
    if (-not $line) { throw 'Official Node.js checksum entry missing' }
    $hash = ([regex]::Match($line, '^[0-9a-fA-F]{64}')).Value
    Install-Package $nodeUrl $hash $nodeFolder 'node' $nodeVersion
  } finally { Remove-Item -LiteralPath $manifest -Force -ErrorAction SilentlyContinue }
}
function Ensure-Python {
  if ((Test-Path -LiteralPath $pythonExe) -and (Verify-Files $pythonFolder)) {
    if ((& $pythonExe --version 2>&1 | Out-String).Trim() -eq "Python $pythonVersion") {
      Stage 'Python is ready for future modules (offline)'; return
    }
  }
  if (Restore-Runtime $pythonFolder $pythonExe "Python $pythonVersion") { return }
  Stage 'Downloading or recovering optional Python'
  Install-Package $pythonUrl $pythonHash $pythonFolder 'python' $pythonVersion
}
function Clean-OldStages {
  Get-ChildItem -LiteralPath $runtime -Directory -Filter 'загрузка-*' -ErrorAction SilentlyContinue | Where-Object {
    ([DateTime]::UtcNow - $_.LastWriteTimeUtc).TotalHours -gt 24
  } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
function Check-Source {
  # Recover missing loader files from verified local copies; never roll back legitimate GitHub updates.
  $safeRoot = Join-Path $runtime 'РезервЗагрузчика'
  $manifest = Join-Path $safeRoot 'контроль.json'
  $names = @(
    'Kiyomira.cjs',
    '08-Запуск/01-Пуск.cjs',
    '08-Запуск/02-Предпроверка.cjs',
    '08-Запуск/03-РезервSQLite.cjs',
    '08-Запуск/04-ВебСервер.cjs',
    '10-Веб/01-Страница.html',
    '10-Веб/02-Стиль.css',
    '10-Веб/03-Приложение.js',
    '10-Веб/06-Личность.css',
    '10-Веб/07-Личность.js',
    '03-Личность/01-КогнитивнаяЛичность.ts'
  )
  New-Item -ItemType Directory -Force -Path $safeRoot | Out-Null
  $previous = @{}
  if (Test-Path -LiteralPath $manifest) {
    $parsed = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $entries = if ($null -ne $parsed.files) { @($parsed.files) } else { @($parsed) }
    foreach ($entry in $entries) {
      $name = [string]$entry.path
      if ($name -notin $names) { throw 'Unexpected file in recovery manifest' }
      $previous[$name] = [string]$entry.sha256
    }
  }
  $updated = @()
  foreach ($name in $names) {
    $file = Join-Path $project $name
    $backup = Join-Path $safeRoot ($name -replace '[/\\]', '_')
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      if (-not $previous.ContainsKey($name) -or -not (Test-Path -LiteralPath $backup -PathType Leaf) -or
          (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $previous[$name]) {
        throw "Cannot safely restore missing source file: $name"
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Path $file -Parent) | Out-Null
      Copy-Item -LiteralPath $backup -Destination $file -Force
      Stage "Restored missing loader file: $name"
    }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if (-not (Test-Path -LiteralPath $backup -PathType Leaf) -or
        (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $hash) {
      # The file exists: treat changed contents as an application update, not an automatic rollback.
      Copy-Item -LiteralPath $file -Destination $backup -Force
    }
    $updated += @{ path = $name; sha256 = $hash }
  }
  $tempManifest = "$manifest.новый"
  [IO.File]::WriteAllText($tempManifest, ((@{ files = $updated } | ConvertTo-Json -Depth 5)), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tempManifest -Destination $manifest -Force
  foreach ($name in @('01-Ядро/01-Запуск.ts','02-Память/01-ПамятьДиалога.ts','03-Личность/01-КогнитивнаяЛичность.ts')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project $name))) { throw "Missing TypeScript source: $name" }
  }
}
try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required' }
  Stage '1/6: Checking filesystem and permissions'
  Assert-Write $runtime
  Assert-Write $data
  Take-Lock
  Clean-OldStages
  Stage '2/6: Checking project source'
  Check-Source
  Stage '3/6: Checking local Node.js'
  Ensure-Node
  Stage '4/6: Preparing optional Python'
  if ($env:KIYOMIRA_SKIP_PYTHON -eq '1') { Stage 'Optional Python download disabled by setting' }
  else { try { Ensure-Python } catch { Stage ('Python skipped: ' + $_.Exception.Message) } }
  Stage '5/6: Preparing future Python packages'
  New-Item -ItemType Directory -Force -Path (Join-Path $runtime 'Библиотеки-Пайтон') | Out-Null
  Stage '6/6: Starting TypeScript core'
  if ($script:lockOwned) { Remove-Item -LiteralPath $startupLock -Force; $script:lockOwned = $false }
  & $nodeExe (Join-Path $project 'Kiyomira.cjs')
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 1 }
  exit $code
} catch {
  $msg = $_.Exception.Message
  Write-Host ('Kiyomira setup failed [' + (Classify-Error $_.Exception) + ']: ' + $msg) -ForegroundColor Red
  try { Write-Log ('Setup failed: ' + $msg) } catch {}
  exit 1
} finally {
  if ($script:lockOwned) { Remove-Item -LiteralPath $startupLock -Force -ErrorAction SilentlyContinue }
}
