# Usage: powershell.exe -NoProfile -File export-pptx.ps1 -Path <pptx> -OutDir <dir> -Width <px>
# stdout: one JSON line {"width":n,"height":n,"notes":[...],"clicks":[n,...],"hidden":[bool,...],"isStatic":bool,"pdf":"<path>"}.
#   clicks = on-click animation effects per slide; hidden = slide hidden in PowerPoint; isStatic = no animation,
#   transition or media anywhere; pdf = PDF of the whole deck (hidden slides included), written to <OutDir>\source.pdf.
# On failure: exit != 0, message on stderr "CODE: detail".
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][int]$Width
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Fail([string]$code, [string]$detail) {
  [Console]::Error.WriteLine("${code}: $detail")
  exit 2
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail 'NOTFOUND' $Path }
$full = (Resolve-Path -LiteralPath $Path).ProviderPath
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Reuse a running PowerPoint if there is one; only quit an instance that this script started.
$app = $null
$startedByUs = $false
try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $app = $null }
if ($null -eq $app) {
  try { $app = New-Object -ComObject PowerPoint.Application } catch { Fail 'NOAPP' $_.Exception.Message }
  $startedByUs = $true
}

# Never open the user's file directly: work on a private temp copy so we can never collide with
# a presentation the operator already has open (possibly with unsaved edits).
$tmpCopy = Join-Path ([IO.Path]::GetTempPath()) ('ppt-share-' + [guid]::NewGuid().ToString('N') + [IO.Path]::GetExtension($full))
$before = @{}
$countBefore = 0
try {
  $countBefore = [int]$app.Presentations.Count
  foreach ($p in $app.Presentations) { $before[[string]$p.FullName] = $true }
} catch {}

$pres = $null
$weOpened = $false
try {
  try {
    Copy-Item -LiteralPath $full -Destination $tmpCopy -Force
  } catch {
    Fail 'OPEN' $_.Exception.Message
  }
  try {
    # Open(FileName, ReadOnly, Untitled, WithWindow): msoTrue = -1, msoFalse = 0
    $pres = $app.Presentations.Open($tmpCopy, -1, 0, 0)
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match 'password|kata sandi') { Fail 'PASSWORD' $msg }
    Fail 'OPEN' $msg
  }
  # Only ours if it is a new presentation (not already open, and the count increased).
  if (-not $before.ContainsKey([string]$pres.FullName) -and [int]$app.Presentations.Count -gt $countBefore) {
    $weOpened = $true
  } else {
    Fail 'INUSE' $full
  }
  $sw = [double]$pres.PageSetup.SlideWidth
  $sh = [double]$pres.PageSetup.SlideHeight
  $height = [int][Math]::Round($Width * $sh / $sw)
  $work = Join-Path $OutDir '_export'
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $pres.Export($work, 'PNG', $Width, $height)
  } catch {
    Fail 'EXPORT' $_.Exception.Message
  }
  $pdfPath = Join-Path $OutDir 'source.pdf'
  try {
    # PDF of the whole deck, hidden slides included. ExportAsFixedFormat cannot be called from
    # PowerShell (its optional Variant arguments fail to convert), and SaveCopyAs(..., ppSaveAsPDF 32)
    # skips hidden slides, so unhide them on this working copy for the save and put the flags back.
    $wasHidden = @()
    foreach ($sl in $pres.Slides) {
      $h = ([int]$sl.SlideShowTransition.Hidden -eq -1)
      $wasHidden += $h
      if ($h) { $sl.SlideShowTransition.Hidden = 0 }
    }
    try {
      $pres.SaveCopyAs($pdfPath, 32)
    } finally {
      for ($i = 0; $i -lt $wasHidden.Count; $i++) {
        if ($wasHidden[$i]) { try { $pres.Slides.Item($i + 1).SlideShowTransition.Hidden = -1 } catch {} }
      }
    }
  } catch {
    Fail 'EXPORT' $_.Exception.Message
  }
  $notes = @()
  $clicks = @()
  $hidden = @()
  $isStatic = $true
  foreach ($slide in $pres.Slides) {
    # On-click effects of the main sequence (msoAnimTriggerOnPageClick = 1).
    $n = 0
    try {
      $seq = $slide.TimeLine.MainSequence
      if ([int]$seq.Count -gt 0) { $isStatic = $false }
      for ($i = 1; $i -le [int]$seq.Count; $i++) {
        if ([int]$seq.Item($i).Timing.TriggerType -eq 1) { $n++ }
      }
      if ([int]$slide.TimeLine.InteractiveSequences.Count -gt 0) { $isStatic = $false }
    } catch { $isStatic = $false }
    $clicks += $n
    $isHidden = $false
    try {
      # ppEffectNone = 0; msoTrue = -1
      if ([int]$slide.SlideShowTransition.EntryEffect -ne 0) { $isStatic = $false }
      $isHidden = ([int]$slide.SlideShowTransition.Hidden -eq -1)
    } catch { $isStatic = $false }
    $hidden += $isHidden
    try {
      foreach ($shape in $slide.Shapes) {
        # msoMedia = 16, msoWebVideo = 25
        if ([int]$shape.Type -eq 16 -or [int]$shape.Type -eq 25) { $isStatic = $false; break }
      }
    } catch { $isStatic = $false }
    $text = ''
    try {
      foreach ($shape in $slide.NotesPage.Shapes) {
        if ($shape.Type -eq 14 -and $shape.PlaceholderFormat.Type -eq 2 -and $shape.HasTextFrame) {
          $text = [string]$shape.TextFrame.TextRange.Text
          break
        }
      }
    } catch { $text = '' }
    $notes += $text
  }
  $result = [ordered]@{
    width = $Width; height = $height; notes = @($notes)
    clicks = @($clicks); hidden = @($hidden); isStatic = $isStatic; pdf = $pdfPath
  }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
}
finally {
  # Close ONLY the presentation this script opened.
  if ($weOpened -and $null -ne $pres) { try { $pres.Close() } catch {} }
  if (Test-Path -LiteralPath $tmpCopy) { try { Remove-Item -LiteralPath $tmpCopy -Force } catch {} }
  # Quit ONLY if this script started PowerPoint and nothing else is open in it.
  if ($startedByUs -and $null -ne $app) {
    try { if ($app.Presentations.Count -eq 0) { $app.Quit() } } catch {}
  }
}
