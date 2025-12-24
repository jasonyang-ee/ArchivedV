#!/bin/bash

echo "Starting (Un)Archived V Development Server..."
echo ""

# Check if node_modules exists
echo "📦 Installing dependencies..."
npm install
npm run build
echo ""


# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "Creating data directory..."
    mkdir -p data
    echo ""
fi

# Create download directory if it doesn't exist
if [ ! -d "download" ]; then
    echo "Creating download directory..."
    mkdir -p download
    echo ""
fi

# Start the application
echo "Starting development servers..."
echo "   - Server Address: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

npm run dev
