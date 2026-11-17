# Builds native/web-bridge on Windows (no bash needed). Same output as the .sh script.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..\native\web-bridge')
try {
  dotnet build WebBridge.csproj -c Release --nologo
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Output "built: $((Get-Location).Path)\bin\Release\net48\web-bridge.exe"
} finally {
  Pop-Location
}
