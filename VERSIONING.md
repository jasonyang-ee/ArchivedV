# ArchivedV - Versioning & Deployment Guide

## 📋 Versioning Strategy

This project uses **Semantic Versioning** (SemVer) managed through `package.json`. Versions follow the format: `MAJOR.MINOR.PATCH`

### Version Types
- **MAJOR** (`X.0.0`): Breaking changes, incompatible API changes
- **MINOR** (`x.Y.0`): New features, backward compatible
- **PATCH** (`x.y.Z`): Bug fixes, backward compatible

## 🚀 Deployment Workflow

### Option 1: Automated Release (Recommended)

#### For New Features/Bug Fixes:
```bash
# Bump version automatically
./scripts/version.sh patch    # or minor/major

# Push changes
git add package.json package-lock.json
git commit -m "chore: bump version to x.y.z"
git push

# Create and push tag
git tag vx.y.z
git push --tags
```

#### For Major Releases:
```bash
./scripts/version.sh major
git add package.json package-lock.json
git commit -m "chore: bump version to x.y.z"
git push
git tag vx.y.z
git push --tags
```

### Option 2: Manual Release via GitHub Actions

1. Go to **Actions** → **Release** → **Run workflow**
2. Select version bump type: `patch`, `minor`, or `major`
3. Click **Run workflow**
4. The workflow will:
   - Run all tests
   - Bump version in `package.json`
   - Build and push Docker images
   - Create GitHub release
   - Tag the commit

### Option 3: Tag-based Release

1. Update version in `package.json` manually
2. Commit changes
3. Create tag: `git tag vx.y.z`
4. Push: `git push --tags`
5. GitHub Actions will automatically build and release

## 🔄 CI/CD Pipeline

### Testing Workflow (`testing.yml`)
- **Trigger**: Push to any branch
- **Jobs**:
  1. **Build_Image**: Build and push test image
  2. **Image_Test**: Test the built image
  3. **Cloudflare_Build_Test**: Test frontend build

### Release Workflow (`release.yml`)
- **Trigger**: Push tags (`v*.*.*`) or manual dispatch
- **Jobs**:
  1. **Test**: Run full test suite
  2. **Release**: Build multi-platform images and create release

### PR Validation (`pr-validation.yml`)
- **Trigger**: Pull requests to main/master
- **Jobs**:
  1. **Validate**: Lint, build, and quick test

## 🐳 Docker Images

Images are published to:
- **Docker Hub**: `${USERNAME_DOCKERHUB}/archivedv`
- **GitHub Container Registry**: `ghcr.io/${username}/archivedv`

### Tags
- `latest`: Latest stable release
- `v1.2.3`: Specific version
- `test`: Test builds (not for production)

### Usage
```bash
# Latest version
docker run -d \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  ${USERNAME_DOCKERHUB}/archivedv:latest

# Specific version
docker run -d \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  ${USERNAME_DOCKERHUB}/archivedv:v1.2.3
```

## 🔧 Version Management Script

The `scripts/version.sh` script helps manage versions:

```bash
# Show current version
./scripts/version.sh

# Bump versions
./scripts/version.sh patch    # 1.2.3 → 1.2.4
./scripts/version.sh minor    # 1.2.3 → 1.3.0
./scripts/version.sh major    # 1.2.3 → 2.0.0
```

## 📝 Release Checklist

Before releasing:
- [ ] All tests pass
- [ ] Changelog updated (if applicable)
- [ ] Breaking changes documented
- [ ] Version bumped appropriately
- [ ] Commit message follows conventional commits

## 🔐 Required Secrets

Set these in your GitHub repository secrets:
- `USERNAME_DOCKERHUB`: Your Docker Hub username
- `TOKEN_DOCKERHUB`: Docker Hub access token
- `TOKEN_GITHUB`: GitHub personal access token (for GHCR)

## 🏷️ Git Tagging Strategy

- **Tags**: `v1.2.3` format only
- **Branches**: `main` for stable, feature branches for development
- **Releases**: Created automatically via GitHub Actions

## 📊 Workflow Status

Monitor your workflows at: `https://github.com/{username}/ArchivedV/actions`

### Common Issues
- **Build fails**: Check Node.js version compatibility
- **Test fails**: Ensure all dependencies are properly installed
- **Push fails**: Verify Docker Hub credentials and permissions