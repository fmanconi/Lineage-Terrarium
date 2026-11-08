<#
.SYNOPSIS
    Installa e registra Lineage: Terrarium nel Menu Start e nella Barra delle Applicazioni (Windows).
    Configura icona pixel art, percorsi pythonw e AppUserModelID.
#>

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$IcoPath = Join-Path $RepoDir "lineage.ico"
$Pythonw = Join-Path $RepoDir ".venv\Scripts\pythonw.exe"

if (-not (Test-Path $Pythonw)) {
    throw "Ambiente Python virtuale non trovato in $Pythonw. Esegui prima 'uv sync'."
}

# 1. Assicura che l'icona .ico sia generata
if (-not (Test-Path $IcoPath)) {
    Write-Host "Generazione dell'icona lineage.ico..."
    & (Join-Path $RepoDir ".venv\Scripts\python.exe") -c "from lineage_server.tray import create_tray_icon_image; from pathlib import Path; img = create_tray_icon_image(size=256); img.save(Path('$($IcoPath -replace '\\', '/')'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])"
}

$WshShell = New-Object -ComObject WScript.Shell

function Create-Shortcut([string]$DestinationPath, [string]$Title, [string]$Arguments = "-m lineage_server.launcher") {
    $parent = Split-Path -Parent $DestinationPath
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $sc = $WshShell.CreateShortcut($DestinationPath)
    $sc.TargetPath = $Pythonw
    $sc.Arguments = $Arguments
    $sc.WorkingDirectory = $RepoDir
    $sc.IconLocation = "$IcoPath,0"
    $sc.Description = "Lineage: Terrarium - Idle Evolution Simulator & Desktop Biome Companion"
    $sc.Save()
    Write-Host "Collegamento creato: $DestinationPath"
}

# 2. Registrazione nel Menu Start (Programs)
$StartPrograms = [Environment]::GetFolderPath('Programs')
$StartLnk = Join-Path $StartPrograms "Lineage Terrarium.lnk"
Create-Shortcut -DestinationPath $StartLnk -Title "Lineage Terrarium" -Arguments "-m lineage_server.desktop --title `"Lineage: Terrarium`""

$StartLauncherLnk = Join-Path $StartPrograms "Lineage Launcher.lnk"
Create-Shortcut -DestinationPath $StartLauncherLnk -Title "Lineage Launcher" -Arguments "-m lineage_server.launcher"

# 3. Registrazione per la Barra delle Applicazioni (User Pinned)
$TaskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
if (Test-Path $TaskbarDir) {
    $TaskbarLnk = Join-Path $TaskbarDir "Lineage Terrarium.lnk"
    Create-Shortcut -DestinationPath $TaskbarLnk -Title "Lineage Terrarium" -Arguments "-m lineage_server.desktop --title `"Lineage: Terrarium`""
}

# 4. Collegamento sul Desktop dell'utente
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$DesktopLnk = Join-Path $DesktopPath "Lineage Terrarium.lnk"
Create-Shortcut -DestinationPath $DesktopLnk -Title "Lineage Terrarium" -Arguments "-m lineage_server.desktop --title `"Lineage: Terrarium`""

Write-Host "`nInstallazione completata con successo!"
Write-Host "Lineage: Terrarium e il suo Launcher sono ora disponibili nel Menu Start, sul Desktop e configurati per la Barra delle Applicazioni."
