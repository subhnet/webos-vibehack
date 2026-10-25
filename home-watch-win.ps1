# Run home-watch.py in the background on Windows: starts at login, logs to %LOCALAPPDATA%\tv-vibehack-home-watch.log
#
# Usage:
#   .\home-watch-win.ps1 192.168.0.110                  # Install / start background watcher
#   .\home-watch-win.ps1 uninstall                      # Remove / stop
#   .\home-watch-win.ps1 status                         # Check if running and view logs
#   .\home-watch-win.ps1 run                            # Run in foreground (for testing)

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ActionOrHost = $env:TV_HOST,

    [Parameter(Position = 1)]
    [string]$TvHost = $env:TV_HOST
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$STARTUP_DIR = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$STARTUP_SCRIPT = [System.IO.Path]::Combine($STARTUP_DIR, "tv-vibehack-home-watch.vbs")
$LOG_FILE = [System.IO.Path]::Combine($env:LOCALAPPDATA, "tv-vibehack-home-watch.log")

# Check if first arg is an action
$action = "start"
if ($ActionOrHost -in @("uninstall", "stop", "status", "run", "start")) {
    $action = $ActionOrHost
} elseif ($ActionOrHost) {
    $TvHost = $ActionOrHost
}

function Find-Python {
    if (Test-Path "venv\Scripts\python.exe") {
        return (Resolve-Path "venv\Scripts\python.exe").Path
    }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        return $py.Source
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    return $null
}

function Get-WatcherProcess {
    return Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq "python.exe" -or $_.Name -eq "pythonw.exe") -and
        $_.CommandLine -like "*home-watch.py*"
    }
}

function Get-WeatherProcess {
    return Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq "python.exe" -or $_.Name -eq "pythonw.exe") -and
        $_.CommandLine -like "*weather-proxy.py*"
    }
}

function Stop-WatcherProcess {
    $procs = @(Get-WatcherProcess) + @(Get-WeatherProcess)
    foreach ($p in $procs) {
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

if ($action -in @("uninstall", "stop")) {
    Stop-WatcherProcess
    if (Test-Path $STARTUP_SCRIPT) {
        Remove-Item -Force $STARTUP_SCRIPT
    }
    Write-Host "Removed. Home opens LG's home again." -ForegroundColor Green
    exit 0
}

if ($action -eq "status") {
    $running = Get-WatcherProcess
    if ($running) {
        Write-Host "Home Watcher is RUNNING (PID: $($running.ProcessId -join ', '))." -ForegroundColor Green
    } else {
        Write-Host "Home Watcher is NOT running." -ForegroundColor Yellow
    }
    $weather = Get-WeatherProcess
    if ($weather) {
        Write-Host "Weather proxy is RUNNING (PID: $($weather.ProcessId -join ', '))." -ForegroundColor Green
    } else {
        Write-Host "Weather proxy is NOT running." -ForegroundColor Yellow
    }
    if (Test-Path $LOG_FILE) {
        Write-Host "`nRecent log output ($LOG_FILE):" -ForegroundColor Cyan
        Get-Content $LOG_FILE -Tail 15
    }
    exit 0
}

# Locate Python
$python = Find-Python
if (-not $python) {
    Write-Error "Python was not found. Please install Python 3 or create a venv."
    exit 1
}

# Check websockets dependency
& $python -c "import websockets" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing websockets..." -ForegroundColor Cyan
    # Installing through the chosen interpreter avoids a global pip targeting a
    # different Python installation than the one that runs the watcher.
    & $python -m pip install websockets
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Could not install websockets for $python."
        exit $LASTEXITCODE
    }
}

if (-not $TvHost) {
    Write-Error "Please specify the TV IP address.`nExample: .\home-watch-win.ps1 192.168.0.110 or `$env:TV_HOST='192.168.0.110'"
    exit 1
}

if ($action -eq "run") {
    Write-Host "Running in foreground. Press Ctrl+C to stop." -ForegroundColor Cyan
    Start-Process -FilePath $python -ArgumentList "weather-proxy.py" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    & $python home-watch.py $TvHost
    exit 0
}

# Action: start / install
Stop-WatcherProcess

$pythonPath = $python
$repoDir = (Resolve-Path ".").Path

# Create persistent startup script in Windows Startup folder (runs silently at login)
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$repoDir"
WshShell.Run """$pythonPath"" home-watch.py $TvHost", 0, False
WshShell.Run """$pythonPath"" weather-proxy.py", 0, False
"@
Set-Content -Path $STARTUP_SCRIPT -Value $vbsContent -Encoding ASCII

# Launch immediately using wscript
Start-Process "wscript.exe" -ArgumentList "`"$STARTUP_SCRIPT`""

Start-Sleep -Seconds 3
$running = Get-WatcherProcess
if ($running) {
    Write-Host "Running in background (PID: $($running.ProcessId -join ', ')). Press Home on the remote." -ForegroundColor Green
    $weather = Get-WeatherProcess
    if (-not $weather) {
        Write-Warning "Weather proxy did not start. Check that weather-proxy.py can bind port 9999."
    }
    Write-Host "Auto-starts at Windows login. Log: $LOG_FILE" -ForegroundColor Cyan
} else {
    Write-Warning "Started process, but could not detect active watcher. Check log: $LOG_FILE"
}
