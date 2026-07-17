@echo off
echo ============================================
echo   HEADFULL CONTAINER - ONE CLICK SETUP
echo ============================================
echo.

REM Check if Docker is installed
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo Docker not found!
    echo.
    echo Install Docker Desktop from:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    echo After install, restart PC and run this script again.
    pause
    exit /b 1
)

echo Docker found. Building container...
echo.

cd /d "%~dp0"
bash launch.sh

echo.
echo ============================================
echo   DONE - Open http://localhost:7681
echo ============================================
pause
