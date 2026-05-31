@echo off
echo ============================================
echo   X-Reviewer — AI Code Review Assistant
echo ============================================
echo.
echo [1/2] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.
echo [2/2] Starting server...
echo.
echo   Health check: http://localhost:3000/health
echo   Webhook:     http://localhost:3000/api/github/webhooks
echo.
echo ============================================
echo.
call npm run dev
pause
