# Versioning & Release Guide

This document describes the versioning strategy and release process for ArchivedV.

## Versioning Strategy

ArchivedV follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Breaking changes or significant rewrites
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

### Version Source

The version is managed in `package.json` as the single source of truth:

```json
{
  "version": "1.2.3"
}
```

## Release Process

### Using the Release Script (Recommended)

The `create-release.sh` script automates the entire release process:

```bash
# From project root
./scripts/create-release.sh [OPTIONS]
```

#### Options

| Option | Description |
|--------|-------------|
| `--major` | Force major version bump |
| `--minor` | Force minor version bump |
| `--patch` | Force patch version bump |
| `--yes`, `-y` | Skip confirmation prompts |
| `--help`, `-h` | Show help message |

#### Auto-Detection

If no option is specified, the script auto-detects the release type:

- Commits with `BREAKING CHANGE:` or `breaking:` → **major**
- Commits with `feat:` → **minor**
- Commits with `fix:` → **patch**
- No conventional commits → defaults to **patch**

#### What the Script Does

1. **Pre-flight checks**
   - Verifies you're in the project root
   - Checks GitHub CLI is installed and authenticated
   - Warns about uncommitted changes
   - Warns if not on main branch

2. **Version bump**
   - Updates `package.json` with new version
   - Generates `package-lock.json`

3. **Changelog update**
   - Adds new version section to `CHANGELOG.md`
   - Includes date and empty sections for changes

4. **Git operations**
   - Commits changes with message `release: vX.Y.Z`
   - Creates git tag `vX.Y.Z`
   - Pushes commit and tag to remote

5. **GitHub release**
   - Creates a draft release on GitHub
   - Extracts changelog content for release notes

### Example Workflow

```bash
# 1. Make your changes and commit them
git add .
git commit -m "feat: add new download format option"

# 2. Create the release
./scripts/create-release.sh

# Output:
# Current version: 1.1.6
# Latest tag: v1.1.6
# Release type (auto-detected): minor
# New version: 1.2.0
# ...

# 3. Edit the CHANGELOG.md to add specific changes
# The script creates empty sections that you can fill in

# 4. Publish the draft release on GitHub
# Visit the GitHub releases page and click "Publish"
```

## GitHub Actions Workflows

### Release Workflow (`release.yml`)

Triggered automatically when a tag matching `v*.*.*` is pushed:

```yaml
on:
  push:
    tags:
      - "v*.*.*"
```

**Jobs:**
1. **build**: Builds multi-platform Docker images (AMD64/ARM64)
2. **publish-release**: Marks the GitHub release as published (not draft)

**Produced Artifacts:**
- Docker images pushed to:
  - Docker Hub: `jasonyangee/archivedv`
  - GitHub Container Registry: `ghcr.io/jasonyang-ee/archivedv`
- Tags created:
  - `v1.2.3` (exact version)
  - `v1.2` (minor version)
  - `v1` (major version)
  - `latest` (from main branch)

### Test Workflow (`test.yml`)

Runs on every push and PR:

```yaml
on:
  push:
    branches: [main, "feature/**"]
  pull_request:
    branches: [main]
  workflow_call:
```

**Tests performed:**
- Docker image builds successfully
- Container starts and responds to health checks
- API endpoints return expected status codes

### PR Validation (`pr-validation.yml`)

Runs on pull requests to main:

- Verifies frontend builds correctly
- Tests Docker build
- Quick container health check

## Manual Release (Alternative)

If you prefer manual control:

```bash
# 1. Update version in package.json
npm version 1.2.3 --no-git-tag-version

# 2. Update CHANGELOG.md manually

# 3. Commit changes
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v1.2.3"

# 4. Create and push tag
git tag v1.2.3
git push
git push --tags

# 5. Create GitHub release manually or let the workflow do it
```

## Changelog Format

The `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [Unreleased]

## [1.2.3] - 2025-12-18

### Added
- New feature description

### Changed
- Change description

### Fixed
- Bug fix description
```

## GitHub Secrets Required

| Secret | Description | Required For |
|--------|-------------|--------------|
| `USERNAME_DOCKERHUB` | Docker Hub username | Docker push |
| `TOKEN_DOCKERHUB` | Docker Hub access token | Docker push |
| `GITHUB_TOKEN` | Auto-provided by GitHub | All workflows |

## Troubleshooting

### Script Fails: "Not authenticated with GitHub CLI"

```bash
gh auth login
```

### Script Fails: "This script must be run from the root of the project"

Make sure you're in the directory containing `package.json` and `CHANGELOG.md`.

### Release Workflow Fails: Docker Login

Ensure secrets are configured in GitHub repository settings:
1. Go to Settings → Secrets and variables → Actions
2. Add `USERNAME_DOCKERHUB` and `TOKEN_DOCKERHUB`

### Tags Not Triggering Workflow

Ensure the tag follows the exact pattern `v*.*.*` (e.g., `v1.2.3`, not `1.2.3`).
