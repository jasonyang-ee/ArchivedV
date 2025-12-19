#!/bin/bash

# Version management script for ArchivedV
# Usage: ./scripts/version.sh [patch|minor|major|current]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get current version
get_current_version() {
    node -p "require('./package.json').version"
}

# Validate version format
validate_version() {
    local version=$1
    if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}Error: Invalid version format. Expected: x.y.z${NC}"
        exit 1
    fi
}

# Bump version
bump_version() {
    local bump_type=$1
    local current_version=$(get_current_version)

    echo -e "${BLUE}Current version: ${current_version}${NC}"

    # Calculate new version
    IFS='.' read -ra VERSION_PARTS <<< "$current_version"
    local major=${VERSION_PARTS[0]}
    local minor=${VERSION_PARTS[1]}
    local patch=${VERSION_PARTS[2]}

    case $bump_type in
        patch)
            patch=$((patch + 1))
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        *)
            echo -e "${RED}Error: Invalid bump type. Use: patch, minor, or major${NC}"
            exit 1
            ;;
    esac

    local new_version="${major}.${minor}.${patch}"
    echo -e "${GREEN}New version: ${new_version}${NC}"

	# Update CHANGELOG.md
	if [ -f CHANGELOG.md ]; then
		# Create a backup
		cp CHANGELOG.md CHANGELOG.md.bak
		
		# Use awk to insert the new version section after "## [Unreleased]"
		awk '
		/^## \[Unreleased\]/ {
			print $0
			print ""
			print "## ['"${new_version}"'] - '"$(date +%Y-%m-%d)"'"
			print ""
			print "### Added"
			print "- "
			print ""
			print "### Changed"
			print "- "
			next
		}
		{ print }
		' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
		
		# Clean up backup
		rm CHANGELOG.md.bak
	fi

    # Update package.json
    npm version "$new_version" --no-git-tag-version --yes
    
	# Commit changes and create git tag
	git add package.json package-lock.json CHANGELOG.md && git commit -m 'chore: bump version to ${new_version}'
    git tag v${new_version}
    git push && git push --tags
}

# Show current version
show_current() {
    local version=$(get_current_version)
    echo -e "${BLUE}Current version: ${version}${NC}"
}

# Main logic
case "${1:-current}" in
    current)
        show_current
        ;;
    patch|minor|major)
        bump_version "$1"
        ;;
    --help|-h)
        echo "Version management script for ArchivedV"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  current    Show current version (default)"
        echo "  patch      Bump patch version (1.2.3 → 1.2.4)"
        echo "  minor      Bump minor version (1.2.3 → 1.3.0)"
        echo "  major      Bump major version (1.2.3 → 2.0.0)"
        echo "  --help     Show this help"
        echo ""
        echo "Examples:"
        echo "  $0              # Show current version"
        echo "  $0 patch        # Bump to next patch version"
        echo "  $0 minor        # Bump to next minor version"
        ;;
    *)
        echo -e "${RED}Error: Unknown command '$1'${NC}"
        echo "Run '$0 --help' for usage information"
        exit 1
        ;;
esac