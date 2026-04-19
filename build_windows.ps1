# OpenClaw Buddy - Windows Release Build (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  OpenClaw Buddy - Windows Release Build" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Detect Version
if (Test-Path "VERSION") {
    $VERSION = (Get-Content "VERSION").Trim()
} else {
    $VERSION = "1.0.0"
}
Write-Host "[1/5] Version: $VERSION"

# 2. Cleanup and Sync
Write-Host "[2/5] Cleaning up internal assets..."
if (!(Test-Path "internal\api\dist")) {
    New-Item -ItemType Directory -Path "internal\api\dist" | Out-Null
}
Remove-Item -Path "internal\api\dist\*" -Recurse -Force -ErrorAction SilentlyContinue

# 3. Build Frontend
Write-Host "[3/5] Building Frontend (React)..."
Push-Location "web"
if (!(Test-Path "node_modules")) {
    Write-Host "[3.1] node_modules not found, installing..."
    npm install --silent
}
npm run build --silent
Pop-Location

Write-Host "[3.2] Syncing Frontend Build to Internal Assets..."
Copy-Item -Path "web\dist\*" -Destination "internal\api\dist\" -Recurse -Force
if (Test-Path "web\public\openclaw2.png") {
    Copy-Item -Path "web\public\openclaw2.png" -Destination "internal\api\dist\" -Force
}

# 4. Build Wails Binary (production only)
Write-Host "[4/5] Building Wails Binary (Production)..." -ForegroundColor Cyan
wails build -platform windows/amd64 -skipbindings -o openclaw-buddy.exe
if ($LASTEXITCODE -ne 0) {
    Write-Error "[FAILED] Wails build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# 5. Organize Release Folder
Write-Host "[5/5] Organizing Release Folder..." -ForegroundColor Cyan
$PKG_NAME = "openclaw-buddy-windows-v$VERSION"
$PKG_DIR = "release\$PKG_NAME"

# Clean up old release folder to ensure a fresh start
if (Test-Path "release") {
    Remove-Item -Path "release" -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path "$PKG_DIR"

# Copy binary
if (Test-Path "build\bin\openclaw-buddy.exe") {
    Copy-Item -Path "build\bin\openclaw-buddy.exe" -Destination "$PKG_DIR\" -Force
}

# Copy Docs
if (Test-Path "README_windows.md") {
    Copy-Item -Path "README_windows.md" -Destination "$PKG_DIR\README.md" -Force
}

# Create env template
$ENV_CONTENT = @"
# 🦞 OpenClaw Buddy (Windows Production)
WEB_PORT=3000
WEB_ROOT="/"
BUDDY_TOKEN="sk-replace-me-on-first-run"
DB_FILE="./data/guardian.db"
OPENCLAW_CONFIG_DIR="~/.openclaw"
BACKUP_DIR="./backups"
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"
CHECK_INTERVAL_SECONDS=60
HEALTH_PORT=18789
MAX_RETRIES=3
SHOW_EXTERNAL_TOOLS=false
"@
$ENV_CONTENT | Out-File -FilePath "$PKG_DIR\env" -Encoding UTF8

Write-Host "[5.1] Creating ZIP archive..."
Compress-Archive -Path "$PKG_DIR\*" -DestinationPath "release\$PKG_NAME.zip" -Force

Write-Host "==========================================" -ForegroundColor Green
Write-Host "[SUCCESS] Windows Release Complete!" -ForegroundColor Green
Write-Host "Final Package: release\$PKG_NAME.zip" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
