@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "APP_DIR=%PROJECT_DIR%note_assistant - git"

if not exist "%APP_DIR%\server.py" (
    echo Note Assistant files were not found next to this launcher.
    pause
    exit /b 1
)

if exist "%APP_DIR%\.venv\Scripts\python.exe" (
    "%APP_DIR%\.venv\Scripts\python.exe" -c "import flask, dotenv" >nul 2>&1
    if not errorlevel 1 set "PYTHON=%APP_DIR%\.venv\Scripts\python.exe"
)

if not defined PYTHON (
    where python.exe >nul 2>&1
    if errorlevel 1 (
        echo Python was not found. Install Python 3.10+ and follow README.md first.
        pause
        exit /b 1
    )
    python.exe -c "import flask, dotenv" >nul 2>&1
    if errorlevel 1 (
        echo Flask dependencies were not found. Follow the first-time setup in README.md.
        pause
        exit /b 1
    )
    set "PYTHON=python.exe"
)

"%PYTHON%" "%PROJECT_DIR%launch_note_assistant.py" %*
if errorlevel 1 pause
