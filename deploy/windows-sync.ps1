param(
    [string]$ServerHost = "",
    [int]$Port = 8080,
    [int]$LocalPort = 8089,
    [switch]$LocalUI,
    [switch]$RemoteUI,
    [switch]$Fullscreen
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RepoDir "renderer\dist-kiosk"

function Test-TcpPort([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 1200) {
    try {
        $ips = [System.Net.Dns]::GetHostAddresses($TargetHost) |
            Where-Object { $_.AddressFamily -eq "InterNetwork" }
        foreach ($ip in $ips) {
            $tcp = New-Object System.Net.Sockets.TcpClient
            try {
                $ar = $tcp.BeginConnect($ip.IPAddressToString, $TargetPort, $null, $null)
                if ($ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $tcp.Connected) {
                    return $true
                }
            } finally {
                $tcp.Close()
            }
        }
    } catch {}
    return $false
}

# 1. Auto-discover the Terrarium server on the LAN first (mDNS), then Tailscale; the host
#    names of the fork's first machine are tried last (ADR 0025)
if ([string]::IsNullOrWhiteSpace($ServerHost)) {
    foreach ($candidate in @("terrarium.local", "terrarium", "smerdino.local", "smerdino")) {
        if (Test-TcpPort -TargetHost $candidate -TargetPort $Port) {
            $ServerHost = $candidate
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($ServerHost)) {
    throw "Impossibile raggiungere il server Terrarium sulla porta $Port (provati terrarium.local, terrarium, smerdino.local e smerdino). Passa -ServerHost <IP>."
}

$StatusUrl = "http://${ServerHost}:${Port}/status"
$Status = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 3
Write-Host ("Connesso a {0}:{1} -> World #{2} (seed {3}, data {4}, client attivi: {5})" -f `
    $ServerHost, $Port, $Status.world, $Status.seed, $Status.date, $Status.clients) -ForegroundColor Cyan

# 2. Decide whether to use the server's hosted UI or the local dist-kiosk UI (if the server hasn't pulled latest yet)
$UseLocalUI = $LocalUI.IsPresent
if (-not $UseLocalUI -and -not $RemoteUI.IsPresent) {
    try {
        $null = Invoke-RestMethod -Uri "http://${ServerHost}:${Port}/god-power" -TimeoutSec 2
    } catch {
        if (Test-Path (Join-Path $DistDir "index.html")) {
            Write-Host "Il server non ha ancora tirato l'ultimo commit UI: uso la build locale aggiornata sincronizzata allo stream live!" -ForegroundColor Yellow
            $UseLocalUI = $true
        }
    }
}

if ($UseLocalUI) {
    if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
        throw "Build locale non trovata in $DistDir. Esegui: cd renderer && npm run build:kiosk"
    }
    if (-not (Test-TcpPort -TargetHost "127.0.0.1" -TargetPort $LocalPort -TimeoutMs 400)) {
        $PyExe = Join-Path $RepoDir ".venv\Scripts\pythonw.exe"
        if (-not (Test-Path $PyExe)) {
            $PyExe = Join-Path $RepoDir ".venv\Scripts\python.exe"
        }
        $HttpArgs = "-m http.server $LocalPort --bind 127.0.0.1 --directory `"$DistDir`""
        Start-Process -FilePath $PyExe -ArgumentList $HttpArgs -WindowStyle Hidden | Out-Null
        for ($i = 0; $i -lt 15; $i++) {
            if (Test-TcpPort -TargetHost "127.0.0.1" -TargetPort $LocalPort -TimeoutMs 250) { break }
            Start-Sleep -Milliseconds 200
        }
    }
    $StreamWs = [System.Uri]::EscapeDataString("ws://${ServerHost}:${Port}/stream")
    $AppUrl = "http://127.0.0.1:${LocalPort}/?source=${StreamWs}&desktop=1"
} else {
    $AppUrl = "http://${ServerHost}:${Port}/?desktop=1"
}

# 3. Launch chromeless pixel-art window (1280x780 = exact 5x integer scale of 256x150 art canvas + titlebar)
$Browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
)
$BrowserExe = $Browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($BrowserExe) {
    # The viewer's profile keeps its settings; one made before the rename (ADR 0025) is reused.
    $ProfileDir = Join-Path $env:LOCALAPPDATA "LineageTerrariumViewer"
    $LegacyProfileDir = Join-Path $env:LOCALAPPDATA "LineageSmerdinoViewer"
    if (-not (Test-Path $ProfileDir) -and (Test-Path $LegacyProfileDir)) {
        $ProfileDir = $LegacyProfileDir
    }
    $BrowserArgLine = "--user-data-dir=`"$ProfileDir`" --app=`"$AppUrl`" --window-size=1280,780"
    if ($Fullscreen) {
        $BrowserArgLine += " --start-fullscreen"
    }
    Start-Process -FilePath $BrowserExe -ArgumentList $BrowserArgLine | Out-Null
    Write-Host "Finestra sincronizzata avviata: $AppUrl" -ForegroundColor Green
} else {
    Start-Process $AppUrl | Out-Null
    Write-Host "Aperto nel browser predefinito: $AppUrl" -ForegroundColor Green
}
