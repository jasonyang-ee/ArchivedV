#!/bin/bash

# ArchivedV - Development Startup Script

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "ArchivedV - Development Mode"
echo ""

# Validate we're in the right directory
if [ ! -f package.json ]; then
    echo -e "${RED}Error: Run this script from the project root (package.json not found).${NC}"
    exit 1
fi

# Install dependencies only if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install || { echo -e "${RED}Error: npm install failed.${NC}"; exit 1; }
fi

# Build client
echo "Building client..."
npm run build || { echo -e "${RED}Error: Build failed.${NC}"; exit 1; }
echo ""

# Ensure data directories exist
mkdir -p data download

# Cleanup handler
cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true
    echo "Stopped."
    exit 0
}

trap cleanup SIGTERM SIGINT

# Start development servers
echo "Starting development servers..."
npm run dev &
DEV_PID=$!

sleep 3
if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo -e "${RED}Error: Development server failed to start.${NC}"
    exit 1
fi

echo -e "${GREEN}OK${NC} Development servers started (PID: $DEV_PID)"
echo ""
echo -e "${GREEN}Servers running:${NC}"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:3000"
echo ""

# Wait for the process to exit
wait "$DEV_PID"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Error: Development server exited unexpectedly (code: $EXIT_CODE).${NC}"
fi

cleanup
exit $EXIT_CODE
