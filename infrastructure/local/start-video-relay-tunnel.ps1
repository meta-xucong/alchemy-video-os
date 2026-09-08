$ErrorActionPreference = "Stop"

# The provider-input URL is a reverse SSH tunnel back to the local Control API.
# Keep one owner for the remote port and reconnect after a transient SSH/network
# failure instead of leaving the relay silently unavailable.
$mutex = [System.Threading.Mutex]::new($false, "Local\AlchemyVideoProviderRelayTunnel")
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  while ($true) {
    try {
      & "D:\AI\SSH\VPS_SSH_KEY\hosts\alchemy-video-OS\connect.ps1" -ExtraSshArgs @(
        "-N",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=10",
        "-R", "127.0.0.1:18080:127.0.0.1:3133"
      )
    } catch {
      # The next iteration performs the bounded reconnect; do not leak the
      # exception into the detached Studio process.
    }
    Start-Sleep -Seconds 2
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
