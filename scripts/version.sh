#!/bin/bash

# =============================================================================
# ArchivedV Version Utility
# =============================================================================
# Simple script to view or manually set version
# For full release workflow, use: ./scripts/create-release.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Get current version from package.json
get_version() {
    node -p "require('./package.json').version"
}

# Show version
show_version() {
    local version=$(get_version)
    echo -e "${BLUE}Current version: ${BOLD}$version${NC}"
}

# Show help
show_help() {
    echo -e "${BOLD}ArchivedV Version Utility${NC}"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  current     Show current version (default)"
    echo "  --help, -h  Show this help"
    echo ""
    echo "For full release workflow with changelog updates and GitHub releases:"
    echo "  ./scripts/create-release.sh"
    echo ""
    echo "Examples:"
    echo "  $0                    # Show current version"
    echo "  ./scripts/create-release.sh           # Auto-detect release type"
    echo "  ./scripts/create-release.sh --patch   # Force patch release"
    echo "  ./scripts/create-release.sh --minor   # Force minor release"
}

# Main
case "${1:-current}" in
    current|"")
        show_version
        ;;
    --help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo "Run '$0 --help' for usage"
        exit 1
        ;;
esac