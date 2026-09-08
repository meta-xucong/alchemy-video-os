param(
  [int] $StudioPort = 3031,
  [int] $ControlApiPort = 3133,
  [int] $MediaRuntimePort = 3433,
  [int] $DocumentRuntimePort = 3434,
  [ValidateSet("mock", "sub2api")]
  [string] $VideoProvider = "mock",
  [string] $ReferenceDeliveryOrigin = "",
  [switch] $AllowEphemeralReferenceTunnel,
  [switch] $SkipBuild,
  [switch] $SkipBackup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WorkspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeRoot = Join-Path $WorkspaceRoot ".codex-longrun\local-acceptance"
$LogRoot = Join-Path $RuntimeRoot "logs"
$BackupRoot = Join-Path $RuntimeRoot "backups"
$StatePath = Join-Path $RuntimeRoot "full-stack-pids.json"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $LogRoot, $BackupRoot | Out-Null
$relayScriptSource = Join-Path $WorkspaceRoot "infrastructure\local\start-video-relay-tunnel.ps1"
$relayScriptRuntime = Join-Path $RuntimeRoot "start-video-relay-tunnel.ps1"
if (Test-Path -LiteralPath $relayScriptSource) {
  Copy-Item -LiteralPath $relayScriptSource -Destination $relayScriptRuntime -Force
}

function Resolve-ToolPath([string] $Name) {
  $tool = Get-Command $Name -ErrorAction Stop
  return $tool.Source
}

function Stop-ManagedLocalProcesses {
  $managedPids = [System.Collections.Generic.HashSet[int]]::new()
  $state = $null
  if (Test-Path -LiteralPath $StatePath) {
    try {
      $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
      foreach ($service in @($state.services)) {
        if ($service.pid) { [void] $managedPids.Add([int] $service.pid) }
      }
    } catch {
      Write-Host ("Ignoring unreadable local process state: {0}" -f $_.Exception.Message)
    }
  }

  $runtimeText = [string] $RuntimeRoot
  $managed = Get-CimInstance Win32_Process | Where-Object {
    if ($managedPids.Contains([int] $_.ProcessId)) { return $true }
    if (-not $_.CommandLine) { return $false }
    $commandLine = ($_.CommandLine -replace "/", "\")
    $commandLine.Contains($runtimeText) -or $commandLine.Contains(".codex-longrun\local-acceptance\") -or ($state -and $state.build_version -and $commandLine.Contains([string] $state.build_version))
  }

  $stopped = [System.Collections.Generic.HashSet[int]]::new()
  function Stop-ManagedProcessTree([int] $ProcessId) {
    if (-not $stopped.Add($ProcessId)) { return }
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      Stop-ManagedProcessTree -ProcessId ([int] $child.ProcessId)
    }
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host ("Stopping managed local process PID {0}: {1}" -f $ProcessId, $process.Name)
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($process in $managed) {
    Stop-ManagedProcessTree -ProcessId ([int] $process.ProcessId)
  }
}

function Assert-PortAvailable([int] $Port, [string] $Name) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listeners) {
    $owners = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    throw "$Name port $Port is still occupied by PID(s): $($owners -join ', ')."
  }
}

function Wait-HttpOk([string] $Url, [string] $Name) {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Write-Host ("{0} is ready: {1}" -f $Name, $Url)
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $deadline)
  throw "$Name did not become ready at $Url."
}

function Wait-TcpOpen([string] $HostName, [int] $Port, [string] $Name) {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $async = $client.BeginConnect($HostName, $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(1000)) {
        $client.EndConnect($async)
        Write-Host ("{0} is ready: {1}:{2}" -f $Name, $HostName, $Port)
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    } finally {
      $client.Dispose()
    }
  } while ((Get-Date) -lt $deadline)
  throw "$Name did not open TCP port $Port."
}

function Run-Pnpm([string] $Label, [string[]] $Arguments) {
  Write-Host $Label
  & $script:PnpmExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Start-LocalService([string] $Name, [string] $FilePath, [string[]] $Arguments, [string] $WorkingDirectory) {
  $safeName = $Name.ToLowerInvariant() -replace "[^a-z0-9]+", "-"
  $stdout = Join-Path $LogRoot "$safeName.out.log"
  $stderr = Join-Path $LogRoot "$safeName.err.log"
  $launchArguments = @($Arguments)
  if ([IO.Path]::GetFileName($FilePath) -ieq "node.exe") {
    $launchArguments += "--alchemy-local-stack=$script:CurrentBuildVersion"
  }
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $launchArguments `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  Write-Host ("Started {0}: PID {1}" -f $Name, $process.Id)
  return [ordered]@{ name = $Name; pid = $process.Id; stdout = $stdout; stderr = $stderr }
}

function Read-LocalEnvFile {
  $path = Join-Path $WorkspaceRoot ".env.local"
  $values = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $values }
  foreach ($line in Get-Content -LiteralPath $path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed -split "=", 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($name) { $values[$name] = $value }
  }
  return $values
}

function Get-SecretConfigValue([hashtable] $DotEnv, [string] $Name) {
  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($processValue) { return $processValue }
  $userValue = [Environment]::GetEnvironmentVariable($Name, "User")
  if ($userValue) { return $userValue }
  if ($DotEnv.ContainsKey($Name) -and $DotEnv[$Name]) { return [string] $DotEnv[$Name] }
  return ""
}

function New-ReferenceDeliverySigningKey {
  return ("local-reference-delivery-" + [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N"))
}

function Resolve-CloudflaredPath {
  $bundled = Join-Path $RuntimeRoot "bin\cloudflared.exe"
  if (Test-Path -LiteralPath $bundled) { return $bundled }
  return Resolve-ToolPath "cloudflared"
}

function Start-CloudflareTunnel([string] $TargetUrl) {
  $binary = Resolve-CloudflaredPath
  $safeName = "reference-delivery-tunnel"
  $stdout = Join-Path $LogRoot "$safeName.out.log"
  $stderr = Join-Path $LogRoot "$safeName.err.log"
  $log = Join-Path $LogRoot "$safeName.cloudflared.log"
  Remove-Item -LiteralPath $stdout, $stderr, $log -Force -ErrorAction SilentlyContinue
  $process = Start-Process `
    -FilePath $binary `
    -ArgumentList @("tunnel", "--no-autoupdate", "--loglevel", "info", "--logfile", $log, "--url", $TargetUrl) `
    -WorkingDirectory $RuntimeRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  $deadline = (Get-Date).AddSeconds(90)
  do {
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      $stderrText = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 40) -join [Environment]::NewLine } else { "" }
      throw "Reference delivery tunnel exited during startup. $stderrText"
    }
    $combined = ""
    if (Test-Path -LiteralPath $log) { $combined += (Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $stderr) { $combined += [Environment]::NewLine + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
    $match = [regex]::Match($combined, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      Write-Host ("Reference delivery tunnel is ready: {0}" -f $match.Value)
      return [ordered]@{ service = [ordered]@{ name = "Reference Delivery Tunnel"; pid = $process.Id; stdout = $stdout; stderr = $stderr; log = $log }; origin = $match.Value }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "Reference delivery tunnel did not publish a public HTTPS URL."
}

function Backup-LocalDatabase {
  $backupFile = Join-Path $BackupRoot "video_local_before_full_stack_$Timestamp.dump"
  $containerName = "alchemy-video-local-postgres-1"
  $container = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $containerName } | Select-Object -First 1
  if (-not $container) {
    Write-Host "Local PostgreSQL container was not found; skipping pg_dump backup."
    return $null
  }
  $remoteDump = "/tmp/video_local_before_full_stack_$Timestamp.dump"
  docker exec $containerName pg_dump -U video_local -d video_local -Fc -f $remoteDump
  if ($LASTEXITCODE -ne 0) { throw "Local PostgreSQL pg_dump failed." }
  docker cp "${containerName}:$remoteDump" $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Copying local PostgreSQL backup failed." }
  docker exec $containerName rm -f $remoteDump | Out-Null
  Write-Host ("Local database backup: {0}" -f $backupFile)
  return $backupFile
}

function Read-MinioEnvironment {
  $containerName = "alchemy-video-local-minio-1"
  $containerJson = docker inspect $containerName 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $containerJson) {
    return @{ AccessKey = "video_local"; SecretKey = "video_local_secret" }
  }
  $container = $containerJson | ConvertFrom-Json
  $values = @{}
  foreach ($entry in $container[0].Config.Env) {
    $parts = $entry -split "=", 2
    if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
  }
  return @{
    AccessKey = if ($values["MINIO_ROOT_USER"]) { $values["MINIO_ROOT_USER"] } else { "video_local" }
    SecretKey = if ($values["MINIO_ROOT_PASSWORD"]) { $values["MINIO_ROOT_PASSWORD"] } else { "video_local_secret" }
  }
}

Stop-ManagedLocalProcesses
Start-Sleep -Milliseconds 700
Assert-PortAvailable -Port $StudioPort -Name "Studio"
Assert-PortAvailable -Port $ControlApiPort -Name "Control API"
Assert-PortAvailable -Port $MediaRuntimePort -Name "Media Runtime"
Assert-PortAvailable -Port $DocumentRuntimePort -Name "Document Runtime"

$script:PnpmExe = Resolve-ToolPath "pnpm"
$NodeExe = Resolve-ToolPath "node"
$PythonExe = Join-Path $WorkspaceRoot ".codex-longrun\c10-document-runtime-venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $PythonExe)) {
  $PythonExe = Resolve-ToolPath "python.exe"
}

$ffmpegPath = Join-Path $WorkspaceRoot "node_modules\.pnpm\ffmpeg-static@5.3.0\node_modules\ffmpeg-static\ffmpeg.exe"
$ffprobePath = Join-Path $WorkspaceRoot "node_modules\.pnpm\ffprobe-static@3.1.0\node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe"
if (-not (Test-Path -LiteralPath $ffmpegPath)) { throw "ffmpeg fixture binary not found: $ffmpegPath" }
if (-not (Test-Path -LiteralPath $ffprobePath)) { throw "ffprobe fixture binary not found: $ffprobePath" }

$minio = Read-MinioEnvironment
$dotenv = Read-LocalEnvFile
$sub2ApiVideoBaseUrl = ""
$sub2ApiVideoApiKey = ""
$previousSub2ApiVideoBaseUrl = [Environment]::GetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", "Process")
$previousSub2ApiVideoApiKey = [Environment]::GetEnvironmentVariable("SUB2API_VIDEO_API_KEY", "Process")
$referenceVisionBaseUrl = Get-SecretConfigValue -DotEnv $dotenv -Name "REFERENCE_VISION_BASE_URL"
$referenceVisionApiKey = Get-SecretConfigValue -DotEnv $dotenv -Name "REFERENCE_VISION_API_KEY"
$referenceVisionModel = Get-SecretConfigValue -DotEnv $dotenv -Name "REFERENCE_VISION_MODEL"
$configuredReferenceDeliveryOrigin = Get-SecretConfigValue -DotEnv $dotenv -Name "REFERENCE_DELIVERY_ORIGIN"
if (($referenceVisionBaseUrl -or $referenceVisionApiKey -or $referenceVisionModel) -and (-not $referenceVisionBaseUrl -or -not $referenceVisionApiKey -or -not $referenceVisionModel)) {
  throw "Reference vision analysis requires REFERENCE_VISION_BASE_URL, REFERENCE_VISION_API_KEY, and REFERENCE_VISION_MODEL together."
}
if ($VideoProvider -eq "sub2api") {
  $sub2ApiVideoBaseUrl = Get-SecretConfigValue -DotEnv $dotenv -Name "SUB2API_VIDEO_BASE_URL"
  $sub2ApiVideoApiKey = Get-SecretConfigValue -DotEnv $dotenv -Name "SUB2API_VIDEO_API_KEY"
  if (-not $sub2ApiVideoBaseUrl -or -not $sub2ApiVideoApiKey) {
    throw "VIDEO_PROVIDER=sub2api requires SUB2API_VIDEO_BASE_URL and SUB2API_VIDEO_API_KEY in the process environment or .env.local."
  }
  $parsedBaseUrl = [Uri] $sub2ApiVideoBaseUrl
  if ($parsedBaseUrl.Scheme -ne "https") {
    throw "SUB2API_VIDEO_BASE_URL must be HTTPS for real provider mode."
  }
}
# Keep video credentials out of the parent environment while non-provider
# services start. They are injected only around the Task Worker launch below.
[Environment]::SetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", $null, "Process")
[Environment]::SetEnvironmentVariable("SUB2API_VIDEO_API_KEY", $null, "Process")
$queuePrefix = "alchemy-video-local-full"
$databaseUrl = "postgresql://video_local:video_local@127.0.0.1:15432/video_local"
$controlApiOrigin = "http://127.0.0.1:$ControlApiPort"
$studioOrigin = "http://localhost:$StudioPort"
$documentRuntimeOrigin = "http://127.0.0.1:$DocumentRuntimePort/"
$mediaRuntimeOrigin = "http://127.0.0.1:$MediaRuntimePort/"
$buildVersion = "local-full-stack-$Timestamp"
$script:CurrentBuildVersion = $buildVersion

$localEnvironment = [ordered]@{
  DATABASE_URL = $databaseUrl
  CONTROL_API_PORT = [string] $ControlApiPort
  CONTROL_API_ORIGIN = $controlApiOrigin
  NITRO_CONTROL_API_ORIGIN = $controlApiOrigin
  REDIS_URL = "redis://127.0.0.1:6380"
  S3_ENDPOINT = "http://127.0.0.1:9002"
  # Keep browser-facing signed URLs on the same localhost host family as
  # Studio. Chrome may block a cross-host loopback download from localhost
  # with ERR_BLOCKED_BY_CLIENT even though the MinIO GET itself succeeds.
  S3_PUBLIC_ENDPOINT = "http://localhost:9002"
  S3_REGION = "us-east-1"
  S3_BUCKET = "video-local"
  S3_ACCESS_KEY = $minio["AccessKey"]
  S3_SECRET_KEY = $minio["SecretKey"]
  S3_BROWSER_ORIGINS = "http://localhost:$StudioPort,http://127.0.0.1:$StudioPort,http://[::1]:$StudioPort"
  LOCAL_AUTH_MODE = "dev"
  VIDEO_PROVIDER = $VideoProvider
  VIDEO_PROMPT_MAX_UTF8_BYTES = "20000"
  VEYRA_AUTH_ENABLED = "false"
  AUDIO_FREE_ONLY = "true"
  PIXABAY_MUSIC_ENABLED = "true"
  STUDIO_LOCAL_DEMO_MODE = if ($VideoProvider -eq "mock") { "true" } else { "false" }
  DOCUMENT_RUNTIME_URL = $documentRuntimeOrigin
  DOCUMENT_RUNTIME_TOKEN = "local-document-runtime-token"
  DOCUMENT_CONVERSION_QUEUE_NAME = "$queuePrefix-document"
  DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME = "$queuePrefix-document-dead-letter"
  DOCUMENT_WORKER_ID = "local-document-worker"
  CREATIVE_PLANNING_QUEUE_NAME = "$queuePrefix-planning"
  CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME = "$queuePrefix-planning-dead-letter"
  WORKFLOW_WORKER_ID = "local-workflow-worker"
  TASK_QUEUE_NAME = "$queuePrefix-task"
  TASK_DEAD_LETTER_QUEUE_NAME = "$queuePrefix-task-dead-letter"
  TASK_WORKER_ID = "local-task-worker"
  PRODUCTION_QUEUE_NAME = "$queuePrefix-production"
  PRODUCTION_DEAD_LETTER_QUEUE_NAME = "$queuePrefix-production-dead-letter"
  MEDIA_RUNTIME_QUEUE_NAME = "$queuePrefix-media"
  MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME = "$queuePrefix-media-dead-letter"
  PRODUCTION_WORKER_ID = "local-production-worker"
  MEDIA_RUNTIME_URL = $mediaRuntimeOrigin
  MEDIA_RUNTIME_TOKEN = "local-media-runtime-token"
  MEDIA_RUNTIME_FFMPEG_PATH = $ffmpegPath
  MEDIA_RUNTIME_FFPROBE_PATH = $ffprobePath
  # Keep the optional transcriber bound to the same controlled interpreter
  # that serves Media Runtime.  OpenMontage's checked transcript/QC path
  # otherwise fails closed even though faster-whisper is installed locally.
  MEDIA_TRANSCRIBER_PYTHON_PATH = $PythonExe
  HF_HOME = (Join-Path $env:USERPROFILE ".cache\huggingface")
  PIPER_MODEL_PATH = (Join-Path $WorkspaceRoot ".codex-longrun\piper-models\zh_CN-huayan-medium.onnx")
  PIPER_MODEL_CONFIG_PATH = (Join-Path $WorkspaceRoot ".codex-longrun\piper-models\zh_CN-huayan-medium.onnx.json")
  PIPER_PYTHON_PATH = $PythonExe
  VIDEO_RELAY_RECONNECT_SCRIPT = (Join-Path $RuntimeRoot "start-video-relay-tunnel.ps1")
  BUILD_VERSION = $buildVersion
  HOST = "::"
  PORT = [string] $StudioPort
  NITRO_HOST = "::"
  NITRO_PORT = [string] $StudioPort
  STUDIO_NUXT_BUILD_DIR = (Join-Path $RuntimeRoot "full-studio\.nuxt")
  STUDIO_NITRO_OUTPUT_DIR = (Join-Path $RuntimeRoot "full-studio\.output")
}

$referenceDeliverySigningKey = ""
if ($VideoProvider -eq "sub2api") {
  $referenceDeliverySigningKey = Get-SecretConfigValue -DotEnv $dotenv -Name "REFERENCE_DELIVERY_SIGNING_KEY"
  if (-not $referenceDeliverySigningKey) { $referenceDeliverySigningKey = New-ReferenceDeliverySigningKey }
}

if ($VideoProvider -eq "sub2api") {
  $localEnvironment.REFERENCE_DELIVERY_ORIGIN = if ($ReferenceDeliveryOrigin) { $ReferenceDeliveryOrigin.Trim() } else { $configuredReferenceDeliveryOrigin.Trim() }
  $localEnvironment.REFERENCE_DELIVERY_SIGNING_KEY = $referenceDeliverySigningKey
}

foreach ($entry in $localEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string] $entry.Value, "Process")
}
# Start-Process on some Windows PowerShell hosts snapshots the parent
# environment before Environment.SetEnvironmentVariable updates are visible.
# Pin the two profile selectors explicitly so every local Worker agrees on the
# same provider and prompt budget.
$env:VIDEO_PROVIDER = $VideoProvider
$env:VIDEO_PROMPT_MAX_UTF8_BYTES = "20000"

Wait-TcpOpen -HostName "127.0.0.1" -Port 15432 -Name "PostgreSQL"
Wait-TcpOpen -HostName "127.0.0.1" -Port 6380 -Name "Redis"
Wait-TcpOpen -HostName "127.0.0.1" -Port 9002 -Name "MinIO"

$backupFile = $null
if (-not $SkipBackup) {
  $backupFile = Backup-LocalDatabase
}

if (-not $SkipBuild) {
  Run-Pnpm -Label "Building C12 local dependencies" -Arguments @("--filter", "@alchemy-video/control-api", "run", "pretest:c12-e2e")
  Run-Pnpm -Label "Building C10 document worker" -Arguments @("--filter", "@alchemy-video/document-worker", "build")
}

Run-Pnpm -Label "Applying local database migrations" -Arguments @("--filter", "@alchemy-video/persistence", "db:migrate")

if ($referenceDeliverySigningKey) {
  [Environment]::SetEnvironmentVariable("REFERENCE_DELIVERY_SIGNING_KEY", $referenceDeliverySigningKey, "Process")
}
$referenceVisionInjected = $false
if ($referenceVisionBaseUrl) {
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_BASE_URL", $referenceVisionBaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_API_KEY", $referenceVisionApiKey, "Process")
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_MODEL", $referenceVisionModel, "Process")
  $referenceVisionInjected = $true
}
$services = @()
$services += Start-LocalService -Name "Control API" -FilePath $NodeExe -Arguments @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\control-api")
Wait-HttpOk -Url "$controlApiOrigin/api/v1/health" -Name "Control API"
if ($referenceDeliverySigningKey) {
  [Environment]::SetEnvironmentVariable("REFERENCE_DELIVERY_SIGNING_KEY", $null, "Process")
}
if ($referenceVisionInjected) {
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_BASE_URL", $null, "Process")
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_API_KEY", $null, "Process")
  [Environment]::SetEnvironmentVariable("REFERENCE_VISION_MODEL", $null, "Process")
}

$referenceDeliveryPublicOrigin = ""
if ($VideoProvider -eq "sub2api") {
  $requestedReferenceDeliveryOrigin = if ($ReferenceDeliveryOrigin) { $ReferenceDeliveryOrigin.Trim() } else { $configuredReferenceDeliveryOrigin.Trim() }
  if ($AllowEphemeralReferenceTunnel) {
    $tunnel = Start-CloudflareTunnel -TargetUrl $controlApiOrigin
    $services += $tunnel.service
    $referenceDeliveryPublicOrigin = $tunnel.origin
  } elseif ($requestedReferenceDeliveryOrigin) {
    $referenceDeliveryPublicOrigin = $requestedReferenceDeliveryOrigin
    if (-not $referenceDeliveryPublicOrigin.StartsWith("https://")) {
      throw "ReferenceDeliveryOrigin must be an HTTPS origin."
    }
  } else {
    throw "Real reference-video mode requires a fixed REFERENCE_DELIVERY_ORIGIN. Pass -AllowEphemeralReferenceTunnel only for temporary local diagnostics; random Quick Tunnel hosts may be rejected by the upstream."
  }
  [Environment]::SetEnvironmentVariable("REFERENCE_DELIVERY_ORIGIN", $referenceDeliveryPublicOrigin, "Process")
}

$services += Start-LocalService -Name "Document Runtime" -FilePath $PythonExe -Arguments @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", [string] $DocumentRuntimePort) -WorkingDirectory (Join-Path $WorkspaceRoot "services\document-runtime")
Wait-TcpOpen -HostName "127.0.0.1" -Port $DocumentRuntimePort -Name "Document Runtime"

# OpenMontage DoubaoTTS.execute reads these source environment names. Resolve
# process/user/.env.local values only for the explicitly started Runtime
# process; do not add a Worker-wide provider default or persist the secret.
$doubaoSpeechApiKey = Get-SecretConfigValue -DotEnv $dotenv -Name "DOUBAO_SPEECH_API_KEY"
$doubaoSpeechVoiceType = Get-SecretConfigValue -DotEnv $dotenv -Name "DOUBAO_SPEECH_VOICE_TYPE"
$previousDoubaoSpeechApiKey = [Environment]::GetEnvironmentVariable("DOUBAO_SPEECH_API_KEY", "Process")
$previousDoubaoSpeechVoiceType = [Environment]::GetEnvironmentVariable("DOUBAO_SPEECH_VOICE_TYPE", "Process")
try {
  if ($doubaoSpeechApiKey) { $env:DOUBAO_SPEECH_API_KEY = $doubaoSpeechApiKey }
  if ($doubaoSpeechVoiceType) { $env:DOUBAO_SPEECH_VOICE_TYPE = $doubaoSpeechVoiceType }
  $services += Start-LocalService -Name "Media Runtime" -FilePath $PythonExe -Arguments @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", [string] $MediaRuntimePort) -WorkingDirectory (Join-Path $WorkspaceRoot "services\media-runtime")
  Wait-TcpOpen -HostName "127.0.0.1" -Port $MediaRuntimePort -Name "Media Runtime"
} finally {
  if ($null -eq $previousDoubaoSpeechApiKey) { Remove-Item -LiteralPath "Env:DOUBAO_SPEECH_API_KEY" -ErrorAction SilentlyContinue } else { $env:DOUBAO_SPEECH_API_KEY = $previousDoubaoSpeechApiKey }
  if ($null -eq $previousDoubaoSpeechVoiceType) { Remove-Item -LiteralPath "Env:DOUBAO_SPEECH_VOICE_TYPE" -ErrorAction SilentlyContinue } else { $env:DOUBAO_SPEECH_VOICE_TYPE = $previousDoubaoSpeechVoiceType }
}

$services += Start-LocalService -Name "Document Worker" -FilePath $NodeExe -Arguments @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\document-worker")
$services += Start-LocalService -Name "Workflow Worker" -FilePath $NodeExe -Arguments @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\workflow-worker")
try {
  if ($VideoProvider -eq "sub2api") {
    [Environment]::SetEnvironmentVariable("REFERENCE_DELIVERY_SIGNING_KEY", $referenceDeliverySigningKey, "Process")
    [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", $sub2ApiVideoBaseUrl, "Process")
    [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_API_KEY", $sub2ApiVideoApiKey, "Process")
  }
  $services += Start-LocalService -Name "Task Worker" -FilePath $NodeExe -Arguments @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\task-worker")
} finally {
  if ($VideoProvider -eq "sub2api") {
    [Environment]::SetEnvironmentVariable("REFERENCE_DELIVERY_SIGNING_KEY", $null, "Process")
  }
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", $null, "Process")
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_API_KEY", $null, "Process")
}
$services += Start-LocalService -Name "Production Worker" -FilePath $NodeExe -Arguments @("--import", "tsx", "src/index.ts") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\production-worker")
Start-Sleep -Seconds 2

foreach ($service in $services) {
  $process = Get-Process -Id $service.pid -ErrorAction SilentlyContinue
  if (-not $process) {
    $stderr = if (Test-Path -LiteralPath $service.stderr) { (Get-Content -LiteralPath $service.stderr -Tail 80) -join [Environment]::NewLine } else { "" }
    throw "$($service.name) exited during startup. $stderr"
  }
}

$services += Start-LocalService -Name "Studio Web" -FilePath $NodeExe -Arguments @("scripts\serve-local.mjs") -WorkingDirectory (Join-Path $WorkspaceRoot "apps\studio-web")
Wait-HttpOk -Url "$studioOrigin/projects" -Name "Studio"
Wait-HttpOk -Url "$studioOrigin/api/v1/health" -Name "Studio API proxy"

# Restore any caller-provided values only after every child process has been
# started, so no non-Task Worker inherits the video credentials.
if ($null -eq $previousSub2ApiVideoBaseUrl) {
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", $null, "Process")
} else {
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_BASE_URL", $previousSub2ApiVideoBaseUrl, "Process")
}
if ($null -eq $previousSub2ApiVideoApiKey) {
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_API_KEY", $null, "Process")
} else {
  [Environment]::SetEnvironmentVariable("SUB2API_VIDEO_API_KEY", $previousSub2ApiVideoApiKey, "Process")
}

$state = [ordered]@{
  started_at = (Get-Date).ToString("o")
  build_version = $buildVersion
  studio_origin = $studioOrigin
  control_api_origin = $controlApiOrigin
  media_runtime_origin = $mediaRuntimeOrigin
  document_runtime_origin = $documentRuntimeOrigin
  database_backup = $backupFile
  mode = [ordered]@{
    local_auth = $localEnvironment.LOCAL_AUTH_MODE
    video_provider = $localEnvironment.VIDEO_PROVIDER
    prompt_max_utf8_bytes = [int] $localEnvironment.VIDEO_PROMPT_MAX_UTF8_BYTES
    effective_prompt_max_utf8_bytes = if ($VideoProvider -eq "sub2api") { 4096 } else { [int] $localEnvironment.VIDEO_PROMPT_MAX_UTF8_BYTES }
    veyra_auth = $localEnvironment.VEYRA_AUTH_ENABLED
    reference_delivery_origin = $referenceDeliveryPublicOrigin
  }
  services = $services
  logs = $LogRoot
}
$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8
Write-Host ("Full local Studio is ready: {0}" -f $studioOrigin)
Write-Host ("Runtime state: {0}" -f $StatePath)
