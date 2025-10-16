@echo off
echo ====================================
echo Lottie to Video Batch Converter
echo ====================================
echo.

REM Проверка установки Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не установлен!
    echo Скачайте и установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js найден: 
node --version
echo.

REM Проверка установки зависимостей
if not exist "node_modules\" (
    echo Зависимости не установлены. Устанавливаем...
    call npm install
    echo.
)

REM Запуск конвертации
echo Начинаем конвертацию...
echo.
node convert-all.js

echo.
echo ====================================
echo Готово!
echo ====================================
pause

