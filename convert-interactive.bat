@echo off
chcp 65001 >nul
echo ====================================
echo Lottie to Video - Интерактивная конвертация
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

REM Проверка установки зависимостей
if not exist "node_modules\" (
    echo Зависимости не установлены. Устанавливаем...
    call npm install
    echo.
)

:menu
cls
echo ====================================
echo Выберите действие:
echo ====================================
echo.
echo 1. Конвертировать ВСЕ файлы из папки models
echo 2. Конвертировать одну конкретную папку
echo 3. Список доступных папок
echo 4. Выход
echo.
set /p choice="Введите номер (1-4): "

if "%choice%"=="1" goto convert_all
if "%choice%"=="2" goto convert_folder
if "%choice%"=="3" goto list_folders
if "%choice%"=="4" goto end
goto menu

:convert_all
cls
echo.
echo Запускаем конвертацию всех файлов...
echo Это может занять МНОГО времени!
echo.
set /p confirm="Вы уверены? (y/n): "
if /i not "%confirm%"=="y" goto menu
echo.
node convert-all.js
echo.
pause
goto menu

:convert_folder
cls
echo.
echo Доступные папки в models:
echo.
dir /b models
echo.
set /p folder="Введите имя папки: "
if not exist "models\%folder%" (
    echo.
    echo Папка не найдена!
    pause
    goto menu
)
echo.
echo Запускаем конвертацию папки: models\%folder%
echo.
node convert-folder.js models\%folder%
echo.
pause
goto menu

:list_folders
cls
echo.
echo Доступные папки в models:
echo ====================================
dir /b models
echo ====================================
echo.
pause
goto menu

:end
echo.
echo До свидания!
exit /b 0

