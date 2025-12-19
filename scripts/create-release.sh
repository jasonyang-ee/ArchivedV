#!/bin/bash

# =============================================================================
# ArchivedV Release Script
# =============================================================================
# This script automates the release process:
# 1. Detects release type (major/minor/patch) based on commit history
# 2. Bumps version in package.json
# 3. Updates CHANGELOG.md with the new version section
# 4. Commits changes, creates git tag, and pushes to remote
# 5. Creates a GitHub draft release with changelog content
#
# Inspired by: https://github.com/pocket-id/pocket-id
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

# Check if the script is being run from the root of the project
if [ ! -f package.json ] || [ ! -f CHANGELOG.md ]; then
    echo -e "${RED}Error: This script must be run from the root of the project.${NC}"
    echo "Required files: package.json, CHANGELOG.md"
    exit 1
fi

# Check if GitHub CLI is installed
if ! command -v gh &>/dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
    echo "Please install it from https://cli.github.com/ and authenticate using 'gh auth login'."
    exit 1
fi

# Check if authenticated with GitHub CLI
if ! gh auth status &>/dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI.${NC}"
    echo "Please run 'gh auth login' to authenticate."
    exit 1
fi

# Check if we're on the main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}Warning: You are on branch '$CURRENT_BRANCH', not 'main'.${NC}"
    read -p "Do you want to continue anyway? (y/n) " CONTINUE
    if [[ "$CONTINUE" != "y" ]]; then
        echo "Release process canceled."
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}Warning: You have uncommitted changes.${NC}"
    git status --short
    read -p "Do you want to continue anyway? (y/n) " CONTINUE
    if [[ "$CONTINUE" != "y" ]]; then
        echo "Release process canceled. Please commit or stash your changes."
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Version Helpers
# -----------------------------------------------------------------------------

# Read current version from package.json
get_current_version() {
    node -p "require('./package.json').version"
}

# Increment version
increment_version() {
    local version=$1
    local part=$2

    IFS='.' read -r -a parts <<< "$version"
    
    case "$part" in
        major)
            parts[0]=$((parts[0] + 1))
            parts[1]=0
            parts[2]=0
            ;;
        minor)
            parts[1]=$((parts[1] + 1))
            parts[2]=0
            ;;
        patch)
            parts[2]=$((parts[2] + 1))
            ;;
    esac
    
    echo "${parts[0]}.${parts[1]}.${parts[2]}"
}

# Extract changelog content for the latest release
extract_changelog() {
    local version=$1
    # Extract content between the first and second version headers
    awk '/^## \[?v?[0-9]/ { if (found) exit; found=1; next } found' CHANGELOG.md
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------

FORCE_TYPE=""
SKIP_CONFIRM=false

for arg in "$@"; do
    case $arg in
        --major)
            FORCE_TYPE="major"
            ;;
        --minor)
            FORCE_TYPE="minor"
            ;;
        --patch)
            FORCE_TYPE="patch"
            ;;
        --yes|-y)
            SKIP_CONFIRM=true
            ;;
        --help|-h)
            echo -e "${BOLD}ArchivedV Release Script${NC}"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --major       Force a major release (x.0.0)"
            echo "  --minor       Force a minor release (x.y.0)"
            echo "  --patch       Force a patch release (x.y.z)"
            echo "  --yes, -y     Skip confirmation prompts"
            echo "  --help, -h    Show this help message"
            echo ""
            echo "If no type is specified, the script will auto-detect based on commits:"
            echo "  - 'feat:' commits → minor release"
            echo "  - 'fix:' commits → patch release"
            echo "  - 'BREAKING CHANGE:' → major release"
            echo ""
            echo "Examples:"
            echo "  $0              # Auto-detect release type"
            echo "  $0 --patch      # Force patch release"
            echo "  $0 --minor -y   # Force minor release, skip confirmation"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            echo "Run '$0 --help' for usage information."
            exit 1
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Determine Release Type
# -----------------------------------------------------------------------------

VERSION=$(get_current_version)
echo -e "${BLUE}Current version: ${BOLD}$VERSION${NC}"

if [ -n "$FORCE_TYPE" ]; then
    RELEASE_TYPE="$FORCE_TYPE"
    echo -e "${CYAN}Release type (forced): ${BOLD}$RELEASE_TYPE${NC}"
else
    # Get the latest tag
    LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    
    if [ -z "$LATEST_TAG" ]; then
        echo -e "${YELLOW}No previous tags found. Defaulting to patch release.${NC}"
        RELEASE_TYPE="patch"
    else
        echo -e "${BLUE}Latest tag: ${BOLD}$LATEST_TAG${NC}"
        
        # Check commit messages since last tag
        COMMITS_SINCE_TAG=$(git log "$LATEST_TAG"..HEAD --oneline 2>/dev/null || echo "")
        
        if [ -z "$COMMITS_SINCE_TAG" ]; then
            echo -e "${YELLOW}No commits since last tag. Nothing to release.${NC}"
            exit 0
        fi
        
        # Auto-detect release type
        if echo "$COMMITS_SINCE_TAG" | grep -qi "BREAKING CHANGE\|breaking:"; then
            RELEASE_TYPE="major"
        elif echo "$COMMITS_SINCE_TAG" | grep -qi "^[a-f0-9]* feat"; then
            RELEASE_TYPE="minor"
        elif echo "$COMMITS_SINCE_TAG" | grep -qi "^[a-f0-9]* fix"; then
            RELEASE_TYPE="patch"
        else
            echo -e "${YELLOW}No conventional commits found (feat:/fix:). Defaulting to patch.${NC}"
            RELEASE_TYPE="patch"
        fi
        
        echo -e "${CYAN}Release type (auto-detected): ${BOLD}$RELEASE_TYPE${NC}"
    fi
fi

# Calculate new version
NEW_VERSION=$(increment_version "$VERSION" "$RELEASE_TYPE")
echo -e "${GREEN}New version: ${BOLD}$NEW_VERSION${NC}"

# -----------------------------------------------------------------------------
# Confirmation
# -----------------------------------------------------------------------------

if [ "$SKIP_CONFIRM" != true ]; then
    echo ""
    echo -e "${YELLOW}This will:${NC}"
    echo "  1. Update package.json to version $NEW_VERSION"
    echo "  2. Add new section to CHANGELOG.md"
    echo "  3. Commit changes with message 'release: v$NEW_VERSION'"
    echo "  4. Create git tag 'v$NEW_VERSION'"
    echo "  5. Push commit and tag to remote"
    echo "  6. Create a GitHub draft release"
    echo ""
    read -p "Do you want to proceed? (y/n) " CONFIRM
    if [[ "$CONFIRM" != "y" ]]; then
        echo -e "${RED}Release process canceled.${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BOLD}Starting release process...${NC}"

# -----------------------------------------------------------------------------
# Update package.json
# -----------------------------------------------------------------------------

echo -e "${BLUE}Updating package.json...${NC}"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
git add package.json package-lock.json

# -----------------------------------------------------------------------------
# Update CHANGELOG.md
# -----------------------------------------------------------------------------

echo -e "${BLUE}Updating CHANGELOG.md...${NC}"
DATE_TODAY=$(date +%Y-%m-%d)

# Create a backup
cp CHANGELOG.md CHANGELOG.md.bak

# Insert new version section after [Unreleased]
awk -v version="$NEW_VERSION" -v date="$DATE_TODAY" '
/^## \[Unreleased\]/ {
    print $0
    print ""
    print "### Added"
    print ""
    print ""
    print "### Changed"
    print ""
    print ""
    print "### Fixed"
    print ""
    print ""
    print "## [" version "] - " date
    next
}
{ print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

rm -f CHANGELOG.md.bak
git add CHANGELOG.md

# -----------------------------------------------------------------------------
# Commit and Tag
# -----------------------------------------------------------------------------

echo -e "${BLUE}Committing changes...${NC}"
git commit -m "release: v$NEW_VERSION"

echo -e "${BLUE}Creating git tag...${NC}"
git tag "v$NEW_VERSION"

# -----------------------------------------------------------------------------
# Push to Remote
# -----------------------------------------------------------------------------

echo -e "${BLUE}Pushing to remote...${NC}"
git push
git push --tags

# -----------------------------------------------------------------------------
# Create GitHub Release
# -----------------------------------------------------------------------------

echo -e "${BLUE}Creating GitHub release...${NC}"

# Extract changelog for this release
CHANGELOG_CONTENT=$(extract_changelog "$NEW_VERSION")

if [ -z "$CHANGELOG_CONTENT" ]; then
    CHANGELOG_CONTENT="Release v$NEW_VERSION"
fi

# Create draft release
if gh release create "v$NEW_VERSION" \
    --title "v$NEW_VERSION" \
    --notes "$CHANGELOG_CONTENT" \
    --draft; then
    echo ""
    echo -e "${GREEN}${BOLD}✓ Release v$NEW_VERSION created successfully!${NC}"
    echo ""
    echo -e "The release has been created as a ${YELLOW}draft${NC}."
    echo -e "Visit the GitHub releases page to review and publish it."
    echo ""
    gh release view "v$NEW_VERSION" --web 2>/dev/null || true
else
    echo -e "${RED}Error: Failed to create GitHub release.${NC}"
    echo "The git tag was pushed successfully. You can create the release manually."
    exit 1
fi

echo ""
echo -e "${GREEN}${BOLD}Release process complete!${NC}"
echo -e "New version: ${BOLD}v$NEW_VERSION${NC}"
