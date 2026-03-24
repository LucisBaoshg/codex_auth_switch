$ErrorActionPreference = 'Stop'

function Get-CodexDir {
  $home = [Environment]::GetFolderPath('UserProfile')
  $codex = Join-Path $home '.codex'
  if (-not (Test-Path $codex)) {
    throw "Codex directory not found: $codex"
  }
  return $codex
}

function Read-ModelProvider([string]$configPath) {
  if (-not (Test-Path $configPath)) {
    throw "config.toml not found: $configPath"
  }

  $lines = Get-Content -LiteralPath $configPath
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if ($trimmed -match '^(model_provider)\s*=\s*(["\"])') {
      if ($trimmed -match '^model_provider\s*=\s*"([^"]+)"') { return $Matches[1] }
      if ($trimmed -match "^model_provider\s*=\s*'([^']+)'" ) { return $Matches[1] }
    }
  }

  throw "model_provider not found in $configPath"
}

function Ensure-Sqlite3([string]$workDir) {
  $exe = Join-Path $workDir 'sqlite3.exe'
  if (Test-Path $exe) { return $exe }

  $zip = Join-Path $workDir 'sqlite3.zip'
  $url = 'https://www.sqlite.org/2024/sqlite-tools-win-x64-3460000.zip'

  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $workDir -Force

  $found = Get-ChildItem -Path $workDir -Recurse -Filter 'sqlite3.exe' | Select-Object -First 1
  if (-not $found) {
    throw 'sqlite3.exe not found after download.'
  }

  Copy-Item -LiteralPath $found.FullName -Destination $exe -Force
  return $exe
}

function Backup-Data([string]$codexDir) {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path $codexDir ("backup-history-fix-" + $timestamp)
  New-Item -ItemType Directory -Path $backupDir | Out-Null

  $dbs = Get-ChildItem -Path $codexDir -Filter 'state_*.sqlite' -File -ErrorAction SilentlyContinue
  if ($dbs) {
    $dbBackup = Join-Path $backupDir 'sqlite'
    New-Item -ItemType Directory -Path $dbBackup | Out-Null
    foreach ($db in $dbs) {
      Copy-Item -LiteralPath $db.FullName -Destination (Join-Path $dbBackup $db.Name) -Force
    }
  }

  foreach ($dirName in @('sessions', 'archived_sessions')) {
    $dirPath = Join-Path $codexDir $dirName
    if (Test-Path $dirPath) {
      $target = Join-Path $backupDir $dirName
      Copy-Item -LiteralPath $dirPath -Destination $target -Recurse -Force
    }
  }

  return $backupDir
}

function Fix-Jsonl([string]$dirPath, [string]$provider) {
  if (-not (Test-Path $dirPath)) { return }
  $files = Get-ChildItem -Path $dirPath -Filter '*.jsonl' -File -Recurse -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    $updated = $content -replace '"model_provider"\s*:\s*"[^"]*"', ('"model_provider":"' + $provider + '"')
    if ($updated -ne $content) {
      Set-Content -LiteralPath $file.FullName -Value $updated -NoNewline
    }
  }
}

function Fix-Sqlite([string]$sqliteExe, [string]$codexDir, [string]$provider) {
  $dbs = Get-ChildItem -Path $codexDir -Filter 'state_*.sqlite' -File -ErrorAction SilentlyContinue
  foreach ($db in $dbs) {
    & $sqliteExe $db.FullName "UPDATE threads SET model_provider = '$provider';" | Out-Null
  }
}

$codexDir = Get-CodexDir
$configPath = Join-Path $codexDir 'config.toml'
$provider = Read-ModelProvider $configPath

$backupDir = Backup-Data $codexDir
$tempDir = Join-Path $env:TEMP 'codex-history-fix'
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$sqliteExe = Ensure-Sqlite3 $tempDir

Fix-Sqlite $sqliteExe $codexDir $provider
Fix-Jsonl (Join-Path $codexDir 'sessions') $provider
Fix-Jsonl (Join-Path $codexDir 'archived_sessions') $provider

Write-Output "Done. Provider=$provider"
Write-Output "Backup: $backupDir"
