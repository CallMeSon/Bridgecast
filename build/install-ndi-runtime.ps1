# Installs the NDI Runtime when it is missing. Called by build/installer.nsh.
# The runtime is downloaded from NDI, never bundled with PPT Share.
#
# Exit codes: 0 runtime present or installed, 2 download failed,
#             3 signature invalid, 4 install failed.
# PPT_SIMULATE_NDI_MISSING=1 makes the presence check report "missing" so the
# download path can be tested on a machine that already has the runtime.
$ErrorActionPreference = 'Stop'

$RuntimeUrl = 'https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe'
$LibraryName = 'Processing.NDI.Lib.x64.dll'

# Same folders as ndiSearchDirs() (Windows part) in src/main/ndi/runtime.ts.
function Get-NdiSearchDirs {
  $dirs = @()
  foreach ($k in 'NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5') {
    $v = [Environment]::GetEnvironmentVariable($k)
    if ($v) { $dirs += $v }
  }
  $root = Join-Path $env:ProgramFiles 'NDI'
  $dirs += (Join-Path $root 'NDI 6 Runtime\v6')
  $dirs += (Join-Path $root 'NDI 6 Tools\Runtime')
  $dirs += (Join-Path $root 'NDI 5 Runtime')
  $dirs += (Join-Path $root 'NDI 5 Tools\Runtime')
  return $dirs
}

function Test-NdiRuntime {
  if ($env:PPT_SIMULATE_NDI_MISSING -eq '1') { return $false }
  foreach ($d in Get-NdiSearchDirs) {
    if (Test-Path -LiteralPath (Join-Path $d $LibraryName)) { return $true }
  }
  return $false
}

if (Test-NdiRuntime) {
  Write-Host 'NDI Runtime already installed.'
  exit 0
}

$installer = Join-Path ([IO.Path]::GetTempPath()) ('ndi-runtime-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
  Write-Host 'Downloading the NDI Runtime...'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $RuntimeUrl -OutFile $installer -UseBasicParsing
    if (-not (Test-Path -LiteralPath $installer) -or (Get-Item -LiteralPath $installer).Length -eq 0) {
      throw 'Empty download.'
    }
  } catch {
    Write-Host ('Download failed: ' + $_.Exception.Message)
    exit 2
  }

  $sig = Get-AuthenticodeSignature -LiteralPath $installer
  if ($sig.Status -ne 'Valid' -or -not $sig.SignerCertificate -or $sig.SignerCertificate.Subject -notlike '*Vizrt*') {
    Write-Host ('Signature check failed (status: ' + $sig.Status + ').')
    exit 3
  }

  Write-Host 'Installing the NDI Runtime...'
  try {
    $p = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
    if ($p.ExitCode -ne 0) {
      Write-Host ('Installer exit code: ' + $p.ExitCode)
      exit 4
    }
  } catch {
    Write-Host ('Install failed: ' + $_.Exception.Message)
    exit 4
  }
  exit 0
} finally {
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}
