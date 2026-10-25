# Sync the TV's apps, package the launcher and install it on an LG TV in Developer Mode.
#   .\install.ps1 -TvHost 192.168.0.110
#   # Or with environment variable:
#   $env:TV_HOST = "192.168.0.110"
#   .\install.ps1
param(
    [Parameter(Position = 0)]
    [string]$TvHost = $env:TV_HOST,

    [Parameter()]
    [string]$Device = $(if ($env:DEVICE) { $env:DEVICE } else { "lgtv" })
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $TvHost) {
    Write-Error "Please specify the TV IP address.`nExample: .\install.ps1 -TvHost 192.168.0.110 or `$env:TV_HOST='192.168.0.110'"
    exit 1
}

$APP_ID = "com.gathin.tvhome"

# Locate Python
$python = $null
if (Test-Path "venv\Scripts\python.exe") {
    $python = (Resolve-Path "venv\Scripts\python.exe").Path
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $python = "py"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $python = "python"
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $python = "python3"
} else {
    Write-Error "Python was not found. Please install Python 3."
    exit 1
}

# Run sync-apps.py
Write-Host "Syncing apps from TV ($TvHost)..." -ForegroundColor Cyan
& $python sync-apps.py $TvHost
if ($LASTEXITCODE -ne 0) {
    Write-Error "sync-apps.py failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# Generate PNG icons if missing (80px and 130px)
if (-not (Test-Path "app\icon.png") -or -not (Test-Path "app\largeIcon.png")) {
    Write-Host "Generating app icons..." -ForegroundColor Cyan
    $iconCreated = $false
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $src = [System.Drawing.Image]::FromFile((Resolve-Path "assets\icon.jpg"))
        foreach ($size in @(80, 130)) {
            $dest = New-Object System.Drawing.Bitmap $size, $size
            $g = [System.Drawing.Graphics]::FromImage($dest)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.DrawImage($src, 0, 0, $size, $size)
            $outFile = if ($size -eq 80) { "app\icon.png" } else { "app\largeIcon.png" }
            $dest.Save((Join-Path $PSScriptRoot $outFile), [System.Drawing.Imaging.ImageFormat]::Png)
            $g.Dispose()
            $dest.Dispose()
        }
        $src.Dispose()
        $iconCreated = $true
    } catch {
        # Fallback to Python PIL if available
        & $python -c "from PIL import Image; img=Image.open('assets/icon.jpg'); img.resize((80,80)).save('app/icon.png'); img.resize((130,130)).save('app/largeIcon.png')" 2>$null
        if (Test-Path "app\icon.png") { $iconCreated = $true }
    }
    if (-not $iconCreated) {
        Write-Warning "Could not generate app\icon.png automatically. Install Pillow or place icon.png in app/."
    }
}

# Execute ares commands via PATH or npx
function Invoke-Ares {
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$AresCmd,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$CmdArgs
    )
    $cmdName = "ares-$AresCmd"
    if (Get-Command $cmdName -ErrorAction SilentlyContinue) {
        & $cmdName @CmdArgs
    } else {
        npx -y -p @webos-tools/cli $cmdName @CmdArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$cmdName failed with exit code $LASTEXITCODE"
    }
}

# Clean and recreate build directory
if (Test-Path "build") {
    Remove-Item -Recurse -Force "build"
}
New-Item -ItemType Directory -Path "build" | Out-Null

Write-Host "Packaging app..." -ForegroundColor Cyan
Invoke-Ares "package" "app" "-o" "build"

$ipkFile = Get-ChildItem -Path "build" -Filter "${APP_ID}_*.ipk" | Select-Object -First 1
if (-not $ipkFile) {
    Write-Error "No .ipk package found in build directory."
    exit 1
}

Write-Host "Installing to device '$Device'..." -ForegroundColor Cyan
Invoke-Ares "install" "-d" $Device $ipkFile.FullName

Write-Host "Launching launcher on TV..." -ForegroundColor Cyan
Invoke-Ares "launch" "-d" $Device $APP_ID

Write-Host "Installed. Hold a number key on the remote while it is open to make it a one-press shortcut." -ForegroundColor Green
