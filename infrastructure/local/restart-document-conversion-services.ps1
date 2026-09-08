[CmdletBinding()]
param(
  [int]$ExistingDocumentWorkerPid = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeRoot = Join-Path $workspaceRoot ".codex-longrun\local-acceptance"
$logRoot = Join-Path $runtimeRoot "logs"
$runtimePython = Join-Path $workspaceRoot ".codex-longrun\c10-document-runtime-venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $runtimePython)) {
  throw "C10 document runtime virtualenv is unavailable."
}

if ($ExistingDocumentWorkerPid -gt 0) {
  $existingWorker = Get-Process -Id $ExistingDocumentWorkerPid -ErrorAction SilentlyContinue
  if ($existingWorker) {
    Stop-Process -Id $ExistingDocumentWorkerPid -Force
  }
}

$runtimeListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3434 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($runtimeListeners.Count -gt 1) {
  throw "Expected at most one Document Runtime listener on port 3434."
}
if ($runtimeListeners.Count -eq 1) {
  Stop-Process -Id $runtimeListeners[0] -Force
}

$minioEnvironment = (docker inspect alchemy-video-local-minio-1 | ConvertFrom-Json)[0].Config.Env
$minioValues = @{}
foreach ($entry in $minioEnvironment) {
  $pair = $entry -split "=", 2
  if ($pair.Count -eq 2) {
    $minioValues[$pair[0]] = $pair[1]
  }
}
if (-not $minioValues["MINIO_ROOT_USER"] -or -not $minioValues["MINIO_ROOT_PASSWORD"]) {
  throw "Local MinIO credentials are unavailable."
}

$localEnvironment = [ordered]@{
  DATABASE_URL = "postgresql://video_local:video_local@127.0.0.1:15432/video_local"
  REDIS_URL = "redis://127.0.0.1:6380"
  S3_ENDPOINT = "http://127.0.0.1:9002"
  S3_REGION = "us-east-1"
  S3_BUCKET = "video-local"
  S3_ACCESS_KEY = $minioValues["MINIO_ROOT_USER"]
  S3_SECRET_KEY = $minioValues["MINIO_ROOT_PASSWORD"]
  LOCAL_AUTH_MODE = "dev"
  VIDEO_PROVIDER = "mock"
  VEYRA_AUTH_ENABLED = "false"
  DOCUMENT_RUNTIME_URL = "http://127.0.0.1:3434/"
  DOCUMENT_RUNTIME_TOKEN = "local-document-runtime-token"
  DOCUMENT_CONVERSION_QUEUE_NAME = "alchemy-video-local-full-document"
  DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME = "alchemy-video-local-full-document-dead-letter"
  DOCUMENT_WORKER_ID = "local-document-worker"
}
foreach ($entry in $localEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$runtime = Start-Process -FilePath $runtimePython -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "3434") -WorkingDirectory (Join-Path $workspaceRoot "services\document-runtime") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "document-runtime-repair.out.log") -RedirectStandardError (Join-Path $logRoot "document-runtime-repair.err.log") -PassThru

$deadline = (Get-Date).AddSeconds(30)
while (-not (Get-NetTCPConnection -State Listen -LocalPort 3434 -ErrorAction SilentlyContinue)) {
  if ((Get-Date) -ge $deadline) {
    throw "Document Runtime did not reopen port 3434."
  }
  Start-Sleep -Milliseconds 250
}

$worker = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $workspaceRoot "apps\document-worker") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "document-worker-repair.out.log") -RedirectStandardError (Join-Path $logRoot "document-worker-repair.err.log") -PassThru
Start-Sleep -Seconds 1
if ($worker.HasExited) {
  throw "Document Worker exited during restart with code $($worker.ExitCode)."
}

[pscustomobject]@{
  runtime_launcher_pid = $runtime.Id
  document_worker_pid = $worker.Id
  document_runtime_port = 3434
} | ConvertTo-Json
