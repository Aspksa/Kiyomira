$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$project = $PSScriptRoot
$runtimeRoot = Join-Path $project '09-Окружение'
$nodeRoot = Join-Path $runtimeRoot 'Нода'
$pythonRoot = Join-Path $runtimeRoot 'Пайтон'
$dataRoot = Join-Path $project '06-Данные'
$log = Join-Path $dataRoot 'журнал-окружения.log'
$nodeVersion = '24.21.0'
$pythonVersion = '3.13.17'
$pythonHash = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"
$nodeChecksumsUrl = "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt"
$pythonArchiveName = "python-$pythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/$pythonArchiveName"
$nodeExe = Join-Path $nodeRoot 'node.exe'
$pythonExe = Join-Path $pythonRoot 'python.exe'
New-Item -ItemType Directory -Force -Path $runtimeRoot, $dataRoot | Out-Null

function Log-Message([string]$message) {
  Add-Content -LiteralPath $log -Value "[$([DateTime]::UtcNow.ToString('o'))] $message" -Encoding UTF8
}

function Get-Download([string]$url, [string]$destination) {
  if (-not ($url.StartsWith('https://nodejs.org/') -or $url.StartsWith('https://www.python.org/'))) {
    throw 'Untrusted download URL'
  }
  Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing -MaximumRedirection 3
}

function Install-Runtime([string]$url, [string]$expectedHash, [string]$destination, [string]$exeRelative, [string]$archiveMode) {
  $scratch = Join-Path $runtimeRoot ("загрузка-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $scratch | Out-Null
  try {
    $zip = Join-Path $scratch 'пакет.zip'
    $unpacked = Join-Path $scratch 'распаковано'
    Get-Download $url $zip
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expectedHash.ToLowerInvariant()) { throw 'SHA256 checksum mismatch' }
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
    if ($archiveMode -eq 'node') {
      $source = Join-Path $unpacked ("node-v$nodeVersion-win-x64")
    } else {
      $source = $unpacked
    }
    if (-not (Test-Path -LiteralPath (Join-Path $source $exeRelative) -PathType Leaf)) {
      throw 'Runtime executable missing in verified archive'
    }
    if (Test-Path -LiteralPath $destination) {
      throw 'Runtime destination exists but executable is missing. Remove broken folder manually.'
    }
    Move-Item -LiteralPath $source -Destination $destination
  } finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-Node {
  if (Test-Path -LiteralPath $nodeExe -PathType Leaf) {
    $versionText = & $nodeExe --version
    if ($LASTEXITCODE -eq 0 -and $versionText -eq "v$nodeVersion") { return }
    throw 'Existing local Node.js has unexpected version. Do not overwrite it automatically.'
  }
  Write-Host 'Downloading portable Node.js...' -ForegroundColor Cyan
  $manifest = Join-Path $runtimeRoot ("node-shasums-" + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    Get-Download $nodeChecksumsUrl $manifest
    $line = Get-Content -LiteralPath $manifest | Where-Object { $_.EndsWith("  $nodeArchiveName") } | Select-Object -First 1
    if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+') { throw 'Node.js checksum missing from official manifest' }
    Install-Runtime $nodeUrl $Matches[1] $nodeRoot 'node.exe' 'node'
  } finally {
    Remove-Item -LiteralPath $manifest -Force -ErrorAction SilentlyContinue
  }
  if ((& $nodeExe --version) -ne "v$nodeVersion") { throw 'Node.js runtime verification failed' }
  Log-Message "Node.js v$nodeVersion installed locally"
}

function Ensure-Python {
  if (Test-Path -LiteralPath $pythonExe -PathType Leaf) {
    $versionText = (& $pythonExe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $versionText -eq "Python $pythonVersion") { return }
    throw 'Existing local Python has unexpected version. Do not overwrite it automatically.'
  }
  Write-Host 'Downloading portable Python for future features...' -ForegroundColor Cyan
  Install-Runtime $pythonUrl $pythonHash $pythonRoot 'python.exe' 'python'
  $versionText = (& $pythonExe --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -ne "Python $pythonVersion") { throw 'Python runtime verification failed' }
  Log-Message "Python $pythonVersion installed locally (not used by core)"
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required for bundled runtimes' }
  Ensure-Node
  try {
    Ensure-Python
  } catch {
    Write-Warning ('Optional Python download failed: ' + $_.Exception.Message)
    Log-Message ('Optional Python download failed: ' + $_.Exception.Message)
  }
  Write-Host 'Starting Kiyomira...' -ForegroundColor Green
  & $nodeExe (Join-Path $project 'Kiyomira.cjs')
  $result = $LASTEXITCODE
  if ($null -eq $result) { $result = 1 }
  exit $result
} catch {
  $message = $_.Exception.Message
  Write-Host ('Startup error: ' + $message) -ForegroundColor Red
  Log-Message ('Startup error: ' + $message)
  exit 1
}
