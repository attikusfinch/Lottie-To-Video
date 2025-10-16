@echo off
chcp 65001 >nul
echo ====================================
echo WebM to MOV Converter
echo ProRes 4444 с прозрачностью
echo ====================================
echo.

REM Проверка Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не установлен!
    pause
    exit /b 1
)

REM Проверка FFmpeg
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] FFmpeg не установлен!
    echo.
    echo Установите FFmpeg:
    echo   https://www.gyan.dev/ffmpeg/builds/
    echo   или: choco install ffmpeg
    echo   или: winget install ffmpeg
    echo.
    pause
    exit /b 1
)

echo Запускаем конвертацию WebM → MOV...
echo.
node webm-to-mov.js

echo.
echo ====================================
echo Готово!
echo ====================================
pause

