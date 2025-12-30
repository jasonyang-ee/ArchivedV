# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 

### Changed

- 

### Fixed

- 

## [1.5.1] - 2025-12-29

### Added

- Dynamic port configuration via `PORT` environment variable (default: 3000)
- Links to current downloads in the web UI for better visibility

### Fixed

- Multiple checks before running autoMerge to avoid using excess resources
- Ensure proper db cleanup after download and merge operations
- Keep logging style consistent across different log messages

## [1.5.0] - 2025-12-27

### Added

- Auto merge feature for audio/video files using ffmpeg after download completion
- Callback support for auto merge operations to ensure proper cleanup timing

### Changed

- yt-dlp now downloads separate audio (140) and video (299) streams instead of merged format
- Removed `--merge-output-format mp4` from yt-dlp arguments to allow manual merging
- Refactored download success handling with consolidated cleanup logic

### Fixed

- Ignore keyword logic now properly checks ignore keywords before keyword filters
- Download cancellation now removes cancelled videos from retry queue
- Enhanced retry queue management to prevent double downloading of ignored videos
- Improved intermediate file cleanup timing and error handling
- Fixed yt-dlp format specification for better audio/video separation 

## [1.4.7] - 2025-12-25

### Fixed

- prevent yt-dlp from hanging on 403 retry loops when stream ends
- reduce excessive feed 404 log spam

## [1.4.6] - 2025-12-23

### Added

- Dev container for VSCode development environment and some updated contribution guidelines

### Changed

- Increasing watchdog timeout to 2 hours to better accommodate long live streams with intermittent network issues.

## [1.4.5] - 2025-12-23

### Added

- 

### Changed

- Default `trust proxy` setting to `1` (trust first proxy only) for better security in Docker reverse proxy deployments

### Fixed

- Fixed express-rate-limit trust proxy validation warnings by properly configuring proxy trust levels and suppressing unnecessary validation checks
- Increased watchdog no-output timeout from 30 minutes to 2 hours to prevent premature killing of live stream downloads during network retries

## [1.4.4] - 2025-12-23

### Fixed

- Delete leftover yt-dlp live fragment files (`*.part-Frag*`, `*.f###.*`) after a successful merge to the final `.mp4`

## [1.4.3] - 2025-12-22

### Added

- Members-only/private video support via `cookies.txt` (UI + API + yt-dlp `--cookies` integration)
- In-memory skip cache for auth-required videos when cookies are not configured (prevents repeated attempts without growing history)
- CI: build and push a Docker `:test` image in the test workflow

### Changed

- Download execution is more resilient: background scheduling/queueing and watchdog logic to avoid missed downloads and stuck processes
- Security hardening: proxy-aware, loopback-exempt rate limiting for expensive handlers

### Fixed

- Prevent download loop/hang caused by yt-dlp `--wait-for-video` on private/members-only videos (detect early and stop)
- Skip auth-required videos cleanly when cookies are not supplied
- Fix “locked/freezing” behavior during update checks and long-running operations

### Security

- Apply rate limiting to filesystem-touching auth/cookies endpoints to satisfy CodeQL `js/missing-rate-limiting` without breaking localhost health checks/reverse proxy

## [1.4.2] - 2025-12-19

### Added

- 

### Changed

- Removed rate limiting middleware to prevent localhost health check and reverse proxy conflicts

### Fixed

- 

## [1.4.1] - 2025-12-19

### Fixed

- Fixed express-rate-limit error when running behind reverse proxy by enabling trust proxy setting

## [1.4.0] - 2025-12-19

### Added

- CONTRIBUTING.md with comprehensive contribution guidelines
- SECURITY.md with security policy and vulnerability reporting process
- Dependabot configuration for automated dependency updates (npm, Docker, GitHub Actions)

### Changed

- Improved release tooling with better error handling and logging
- Enhanced CI/CD pipeline with automated dependency management
- Skip tests for documentation-only commits (starting with "doc: ")

### Fixed

- Changelog formatting issues in create-release.sh script
- Release token naming in GitHub Actions workflows
- Various syntax and permission fixes in CI/CD scripts
- YAML syntax error in test workflow condition

### Security

- Added rate limiting middleware to prevent DoS attacks
- Implemented express-rate-limit with configurable limits
- Added stricter rate limiting for expensive operations (refresh endpoint)
- Added SSRF protection with URL validation for YouTube requests
- Implemented allow-list validation for YouTube domains only
- Blocked localhost and private IP ranges in HTTP requests
- Added additional username sanitization to prevent URL manipulation attacks 

## [1.3.0] - 2025-12-19

### Added

- CONTRIBUTING.md with comprehensive contribution guidelines
- SECURITY.md with security policy and vulnerability reporting process
- Dependabot configuration for automated dependency updates (npm, Docker, GitHub Actions)

### Changed

- Improved release tooling with better error handling and logging
- Enhanced CI/CD pipeline with automated dependency management

### Fixed

- Changelog formatting issues in create-release.sh script
- Release token naming in GitHub Actions workflows
- Various syntax and permission fixes in CI/CD scripts

### Security

- Added rate limiting middleware to prevent DoS attacks
- Implemented express-rate-limit with configurable limits
- Added stricter rate limiting for expensive operations (refresh endpoint)
- Added SSRF protection with URL validation for YouTube requests
- Implemented allow-list validation for YouTube domains only
- Blocked localhost and private IP ranges in HTTP requests
- Added additional username sanitization to prevent URL manipulation attacks 

## [1.2.3] - 2025-12-18

### Fixed

- Minor tweaks and improvements

## [1.2.2] - 2025-12-18

### Fixed

- changelog format issue in create-release.sh

## [1.2.1] - 2025-12-18

### Fixed

- release token name typo in release.yml

## [1.2.0] - 2025-12-18

### Changed

- Refactored CI/CD pipeline with professional release workflow
- Migrated to tag-triggered releases (like pocket-id)
- Added create-release.sh script for automated versioning
- Simplified version.sh to be a utility script
- Updated GitHub Actions to modern versions

## [1.1.4] - 2025-12-18

### Added

- Initial CI/CD pipeline with semantic versioning
- Comprehensive testing workflow  
- Multi-platform Docker builds (AMD64/ARM64)
- Automated release management
- PR validation workflow

### Changed

- Migrated from git tag-based to package.json-based versioning

## [1.1.3] - 2025-12-18

### Fixed
- Patch React again
- Using node environment command for yt-dlp for better support
- Patch logical error where video may accidentally get deleted after merge but with missed final pack from youtube

## [1.1.2] - 2025-12-04

### Changed
- Bump all stack to latest package to reduce security risk. Using node v24 now.
- Removed arm v7 support.

## [1.1.1] - 2025-10-06

### Added
- Ignore keyword list
- Abort function and auto append video title to ignore list
- User date format option
- PNG thumbnail saving

### Fixed
- Aborted video folder deletion with delay of OS file clean up

### Changed
- Reduced image build size

## [1.0.8] - 2025-10-05

### Added
- Better Layout
- Display multiple current downloads properly
- Auto sort channel list

### Changed
- Removed a few icons
- Avoid accidental clear of current downloading list on other threads
- Clear current downloading on init

## [1.0.7] - 2025-10-05

### Changed
- Refactored entire style
- Refactored backend
- App should be backward compatible

## [1.0.6] - 2025-10-04

### Added
- Date and time prefix to downloaded folder
- Lean error message on server side

### Fixed
- Skip not started live
- Cache write permission error

## [1.0.5] - 2025-06-04

### Added
- Docker auto health check
- More server side logs on refresh

## [1.0.4] - 2025-05-31

### Added
- Logo
- Better documentation

### Fixed
- Deal with ETIMEDOUT issue from youtube source

## [1.0.3] - 2025-05-24

### Added
- Test CI
- Cron schedule log to server side
- Update server init log to better describe web ui port

## [1.0.2] - 2025-05-23

### Added
- Screenshot
- Web UI link:port description

### Changed
- Correct readme
- Fixed example wording

### Fixed
- Pushover crash

## [1.0.1] - 2025-05-23

### Added
- Readme

### Changed
- Rename site title
- Restructure folders

## [1.0.0] - 2025-05-23

### Added
- Initial release of ArchivedV
- Video archiving functionality
- Web interface with React
- REST API with Express.js
- Docker containerization
- yt-dlp integration for video downloads

### Technical
- Node.js runtime
- Tailwind CSS for styling
- Vite for frontend build
- Express.js server
- JSON database for data storage
