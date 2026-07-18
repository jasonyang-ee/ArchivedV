#!/bin/bash

# =============================================================================
# ArchivedV Release Script
# =============================================================================
# This script automates the release process:
# 1. Detects release type (major/minor/patch) based on commit history
# 2. Runs the test suite before touching any file
# 3. Bumps version in package.json
# 4. Updates CHANGELOG.md with the new version section
# 5. Commits changes, creates git tag, and pushes to remote
# 6. Creates a GitHub draft release with changelog content
# =============================================================================

set -euo pipefail

# Colors for output
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m' # No Color

REPO_URL="https://github.com/jasonyang-ee/ArchivedV"

die() {
    echo "${RED}Error: $1${NC}" >&2
    exit 1
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------

FORCE_TYPE=""
SKIP_CONFIRM=false
DRY_RUN=false

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
        --dry-run|-n)
            DRY_RUN=true
            ;;
        --help|-h)
            echo "${BOLD}ArchivedV Release Script${NC}"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --major        Force a major release (x.0.0)"
            echo "  --minor        Force a minor release (x.y.0)"
            echo "  --patch        Force a patch release (x.y.z)"
            echo "  --yes, -y      Skip confirmation prompts"
            echo "  --dry-run, -n  Show the release plan without changing anything"
            echo "  --help, -h     Show this help message"
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
            echo "  $0 --dry-run    # Preview the release plan"
            exit 0
            ;;
        *)
            echo "${RED}Unknown option: $arg${NC}"
            echo "Run '$0 --help' for usage information."
            exit 1
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

# Check if the script is being run from the root of the project
if [ ! -f package.json ] || [ ! -f CHANGELOG.md ]; then
    die "This script must be run from the root of the project (needs package.json, CHANGELOG.md)."
fi

command -v node &>/dev/null || die "node is not installed."
command -v npm &>/dev/null || die "npm is not installed."

# Check if GitHub CLI is installed and authenticated
if ! command -v gh &>/dev/null; then
    die "GitHub CLI (gh) is not installed. Install from https://cli.github.com/ and run 'gh auth login'."
fi
if ! gh auth status &>/dev/null; then
    die "Not authenticated with GitHub CLI. Run 'gh auth login'."
fi

# Check if we're on the main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "${YELLOW}Warning: You are on branch '$CURRENT_BRANCH', not 'main'.${NC}"
    read -r -p "Do you want to continue anyway? (y/n) " CONTINUE
    if [[ "$CONTINUE" != "y" ]]; then
        echo "Release process canceled."
        exit 1
    fi
fi

# The tag must describe the committed tree exactly — hard stop on dirty state
if ! git diff-index --quiet HEAD --; then
    git status --short
    die "Uncommitted changes — commit or stash them first."
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

# Extract the body of the [Unreleased] section (everything until the next ## header)
extract_unreleased() {
    awk '/^## \[Unreleased\]/ { found=1; next } /^## / { if (found) exit } found' CHANGELOG.md
}

# -----------------------------------------------------------------------------
# Determine Release Type
# -----------------------------------------------------------------------------

VERSION=$(get_current_version)
echo "${BLUE}Current version: ${BOLD}$VERSION${NC}"

if [ -n "$FORCE_TYPE" ]; then
    RELEASE_TYPE="$FORCE_TYPE"
    echo "${CYAN}Release type (forced): ${BOLD}$RELEASE_TYPE${NC}"
else
    # Get the latest tag
    LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    if [ -z "$LATEST_TAG" ]; then
        echo "${YELLOW}No previous tags found. Defaulting to patch release.${NC}"
        RELEASE_TYPE="patch"
    else
        echo "${BLUE}Latest tag: ${BOLD}$LATEST_TAG${NC}"

        # Check commit messages since last tag
        COMMITS_SINCE_TAG=$(git log "$LATEST_TAG"..HEAD --oneline 2>/dev/null || echo "")

        if [ -z "$COMMITS_SINCE_TAG" ]; then
            echo "${YELLOW}No commits since last tag. Nothing to release.${NC}"
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
            echo "${YELLOW}No conventional commits found (feat:/fix:). Defaulting to patch.${NC}"
            RELEASE_TYPE="patch"
        fi

        echo "${CYAN}Release type (auto-detected): ${BOLD}$RELEASE_TYPE${NC}"
    fi
fi

# Calculate new version
NEW_VERSION=$(increment_version "$VERSION" "$RELEASE_TYPE")
TAG="v$NEW_VERSION"
echo "${GREEN}New version: ${BOLD}$NEW_VERSION${NC}"

# -----------------------------------------------------------------------------
# Release Guards
# -----------------------------------------------------------------------------

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    die "Tag ${TAG} already exists."
fi

UNRELEASED_BODY=$(extract_unreleased)
# Strip blank lines, ### headers, and bare "- " placeholders; anything left is real content
UNRELEASED_CONTENT=$(echo "$UNRELEASED_BODY" | grep -v '^###' | grep -v '^[[:space:]]*$' | grep -v '^-[[:space:]]*$' || true)
if [ -z "$UNRELEASED_CONTENT" ]; then
    die "CHANGELOG.md [Unreleased] section is empty — nothing to release."
fi

echo ""
echo "${BOLD}Release notes preview:${NC}"
echo "$UNRELEASED_BODY"
echo ""

# -----------------------------------------------------------------------------
# Dry Run
# -----------------------------------------------------------------------------

if [ "$DRY_RUN" = true ]; then
    echo "${CYAN}${BOLD}Dry run — no changes made.${NC}"
    echo "Would: test → bump ${NEW_VERSION} → changelog → commit → tag ${TAG} → push ${CURRENT_BRANCH} + ${TAG} → draft GitHub release"
    if [ "$SKIP_CONFIRM" = true ]; then
        echo "(--yes given: confirmation prompt would be skipped)"
    fi
    exit 0
fi

# -----------------------------------------------------------------------------
# Confirmation
# -----------------------------------------------------------------------------

if [ "$SKIP_CONFIRM" != true ]; then
    read -r -p "Do you want to proceed? (y/n) " CONFIRM
    if [[ "$CONFIRM" != "y" ]]; then
        echo "${RED}Release process canceled.${NC}"
        exit 1
    fi
fi

echo ""
echo "${BOLD}Starting release process...${NC}"

# -----------------------------------------------------------------------------
# Run Tests (before any file mutation)
# -----------------------------------------------------------------------------

echo "${BLUE}Running tests...${NC}"
npm test || die "Tests red — not releasing."

# -----------------------------------------------------------------------------
# Update package.json
# -----------------------------------------------------------------------------

echo "${BLUE}Updating package.json...${NC}"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version

# -----------------------------------------------------------------------------
# Update CHANGELOG.md
# -----------------------------------------------------------------------------

echo "${BLUE}Updating CHANGELOG.md...${NC}"
DATE_TODAY=$(date +%Y-%m-%d)

# Insert the new version header after [Unreleased]; existing content flows under it
awk -v version="$NEW_VERSION" -v date="$DATE_TODAY" '
/^## \[Unreleased\]/ {
    print $0
    print ""
    print "## [" version "] - " date
    next
}
{ print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

# Update link definitions: refresh [Unreleased] compare URL, add the new tag
if grep -q '^\[Unreleased\]:' CHANGELOG.md; then
    sed -i "s|^\[Unreleased\]:.*|[Unreleased]: ${REPO_URL}/compare/${TAG}...HEAD|" CHANGELOG.md
else
    printf '\n[Unreleased]: %s/compare/%s...HEAD\n' "$REPO_URL" "$TAG" >> CHANGELOG.md
fi
printf '[%s]: %s/releases/tag/%s\n' "$NEW_VERSION" "$REPO_URL" "$TAG" >> CHANGELOG.md

# -----------------------------------------------------------------------------
# Verify mutations before committing
# -----------------------------------------------------------------------------

grep -q "^## \[${NEW_VERSION}\]" CHANGELOG.md || die "CHANGELOG.md missing ${NEW_VERSION} section after update."
[ "$(get_current_version)" = "$NEW_VERSION" ] || die "package.json version is not ${NEW_VERSION} after bump."

git add package.json package-lock.json CHANGELOG.md

# -----------------------------------------------------------------------------
# Commit and Tag
# -----------------------------------------------------------------------------

echo "${BLUE}Committing changes...${NC}"
git commit -m "release: ${TAG}"

echo "${BLUE}Creating git tag...${NC}"
git tag "$TAG"

# -----------------------------------------------------------------------------
# Push to Remote
# -----------------------------------------------------------------------------

echo "${BLUE}Pushing to remote...${NC}"
git push -q origin "$CURRENT_BRANCH"
git push -q origin "$TAG"

# -----------------------------------------------------------------------------
# Create GitHub Release
# -----------------------------------------------------------------------------

echo "${BLUE}Creating GitHub release...${NC}"

CHANGELOG_CONTENT="$UNRELEASED_BODY"
if [ -z "$CHANGELOG_CONTENT" ]; then
    CHANGELOG_CONTENT="Release ${TAG}"
fi

# Create draft release (release.yml publishes it after the image build succeeds)
if gh release create "$TAG" \
    --title "$TAG" \
    --notes "$CHANGELOG_CONTENT" \
    --draft; then
    echo ""
    echo "${GREEN}${BOLD}Release ${TAG} created successfully!${NC}"
    echo ""
    echo "The release has been created as a ${YELLOW}draft${NC}."
    echo "The Release workflow will publish it once the container build succeeds."
    echo ""
    gh release view "$TAG" --web 2>/dev/null || true
else
    die "Failed to create GitHub release. The git tag was pushed; create the release manually."
fi

echo ""
echo "${GREEN}${BOLD}Release process complete!${NC}"
echo "New version: ${BOLD}${TAG}${NC}"
