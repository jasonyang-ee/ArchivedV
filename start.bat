@echo off
echo Starting (Un)Archived V Development Server...
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Create data directory if it doesn't exist
if not exist "data\" (
    echo Creating data directory...
    mkdir data
    echo.
)

REM Create download directory if it doesn't exist
if not exist "download\" (
    echo Creating download directory...
    mkdir download
    echo.
)

REM Start the application
echo Starting development servers...
echo    - Backend API: http://localhost:3000
echo    - Frontend: http://localhost:5173
echo.
echo Press Ctrl+C to stop
echo.

npm run dev
