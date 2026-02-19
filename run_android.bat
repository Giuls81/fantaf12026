@echo off
setlocal
echo.
echo ========================================
echo [FantaF1] ANDROID RUN HELPER (AUTO-TARGET)
echo ========================================
echo.

:: Java Configuration
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"

:: Android SDK Configuration
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

:: Node Path
set "NODE_PATH=C:\Program Files\nodejs"

:: Update PATH
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%NODE_PATH%;%PATH%"

echo [1/4] Web Build (Compiling React)...
cd web
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [!] ERROR: Web build failed.
    pause
    exit /b 1
)
cd ..

echo.
echo [2/4] Capacitor Sync (Copying to Android)...
call npx cap sync android
if %ERRORLEVEL% neq 0 (
    echo [!] ERROR: Capacitor sync failed.
    pause
    exit /b 1
)

echo.
echo [3/4] Check Version:
call java -version

echo.
echo [4/4] Run on Pixel 8 (Auto-Selecting)...
:: We use --target=Pixel_8 to avoid the double-choice prompt
call npx cap run android --target=Pixel_8

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] ERROR: npx cap run android FAILED.
    echo Se l'emulatore e' chiuso, caricalo prima da Android Studio.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo [FantaF1] SUCCESS! 
echo ========================================
pause
endlocal
