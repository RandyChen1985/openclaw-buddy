@echo off
setlocal enabledelayedexpansion

:: 🦞 OpenClaw Buddy Windows Build Script
:: Requirement: Go, Node.js, and Wails CLI installed

echo.
echo ==========================================
echo   OpenClaw Buddy - Windows Build Process
echo ==========================================
echo.

:: 1. Version Detection
if exist VERSION (
    set /p VERSION=<VERSION
) else (
    set VERSION=1.0.0
)
echo [1/4] Detected Version: !VERSION!

:: 2. Dependencies Check
echo [2/4] Checking Wails CLI...
where wails >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Wails CLI not found. Please run: go install github.com/wailsapp/wails/v2/cmd/wails@latest
    exit /b 1
)

:: 3. Frontend Pre-build (Optional but recommended to ensure sync)
echo [3/4] Preparing Frontend...
cd web
call npm install --silent
cd ..

:: 3.5 Sync Icons for backend embedding
echo [3.5/4] Syncing Backend Icons...
if not exist "internal\api\dist" mkdir "internal\api\dist"
if exist "web\public\openclaw2.png" (
    copy /Y "web\public\openclaw2.png" "internal\api\dist\" >nul
    echo ✅ Icon synced.
)

:: 4. Wails Build
echo [4/4] Starting Wails Build (this may take a few minutes)...
:: This command will:
:: - Sync frontend assets
:: - Compile Go backend for Windows
:: - Embed assets and icons
:: - Generate the final .exe
wails build -platform windows/amd64 -ldflags "-s -w -X 'openclaw-buddy/internal/config.Version=%VERSION%'" -o openclaw-buddy.exe

if %ERRORLEVEL% equ 0 (
    echo.
    echo ==========================================
    echo [SUCCESS] Windows Build Complete!
    echo Final binary: build\bin\openclaw-buddy.exe
    echo ==========================================
    echo.
) else (
    echo.
    echo [FAILED] Wails build encountered an error.
    exit /b 1
)

pause
