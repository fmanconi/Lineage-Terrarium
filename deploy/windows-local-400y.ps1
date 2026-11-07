param(
    [int]$Port = 8090,
    [int]$YearsAhead = 400,
    [switch]$RebuildWorld,
    [switch]$Fullscreen
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$PyExe = Join-Path $RepoDir ".venv\Scripts\python.exe"
$PywExe = Join-Path $RepoDir ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $PywExe)) { $PywExe = $PyExe }
$DataDir = Join-Path $RepoDir ("data\local-{0}y" -f $YearsAhead)
$DistDir = Join-Path $RepoDir "renderer\dist-kiosk"

function Test-TcpPort([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 500) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect($TargetHost, $TargetPort, $null, $null)
        return ($ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $tcp.Connected)
    } catch {
        return $false
    } finally {
        $tcp.Close()
    }
}

# 1. Bootstrap the 400-year future island if no save exists yet (or if -RebuildWorld is requested)
$SavesDir = Join-Path $DataDir "saves"
$HasSave = (Test-Path $SavesDir) -and ((Get-ChildItem -Path $SavesDir -Filter "*.lzma" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
if (-not $HasSave -or $RebuildWorld) {
    Write-Host "Generazione dell'isola $YearsAhead anni nel futuro in corso (~60s la prima volta)..." -ForegroundColor Yellow
    $BootstrapScript = Join-Path $PSScriptRoot "bootstrap_400y.py"
    $ForceArgs = if ($RebuildWorld) { @("--force") } else { @() }
    & $PyExe $BootstrapScript --data $DataDir --years $YearsAhead @ForceArgs
}

# 2. Start the local Lineage server on 127.0.0.1:$Port if not already running
if (-not (Test-TcpPort -TargetHost "127.0.0.1" -TargetPort $Port)) {
    $ServerArgs = "-m lineage_server.main --data `"$DataDir`" --dist `"$DistDir`" --port $Port --years-ahead $YearsAhead --headless --solar"
    Start-Process -FilePath $PywExe -WorkingDirectory $RepoDir -ArgumentList $ServerArgs -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-TcpPort -TargetHost "127.0.0.1" -TargetPort $Port -TimeoutMs 300) { break }
        Start-Sleep -Milliseconds 250
    }
}

$Status = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/status" -TimeoutSec 5
Write-Host ("Isola locale (+{0} anni) attiva su 127.0.0.1:{1} -> World #{2}, data {3}" -f `
    $YearsAhead, $Port, $Status.world, $Status.date) -ForegroundColor Cyan

# 3. Open chromeless pixel-art window (separate profile from Smerdino sync viewer so settings/sleepMode stay independent!)
$AppUrl = "http://127.0.0.1:${Port}/?desktop=1"
$Browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
)
$BrowserExe = $Browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($BrowserExe) {
    $ProfileDir = Join-Path $env:LOCALAPPDATA "LineageFuture400Y"
    $BrowserArgLine = "--user-data-dir=`"$ProfileDir`" --app=`"$AppUrl`" --window-size=1280,780"
    if ($Fullscreen) {
        $BrowserArgLine += " --start-fullscreen"
    }
    Start-Process -FilePath $BrowserExe -ArgumentList $BrowserArgLine | Out-Null
    Write-Host "Finestra avviata: $AppUrl (Premi N o clicca [N] Night in basso a destra per il buio da notte!)" -ForegroundColor Green
} else {
    Start-Process $AppUrl | Out-Null
}
