# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial CI/CD pipeline with semantic versioning
- Comprehensive testing workflow
- Multi-platform Docker builds (AMD64/ARM64)
- Automated release management
- PR validation workflow

### Changed
- Migrated from git tag-based to package.json-based versioning

### Technical
- Added GitHub Actions workflows for testing, release, and PR validation
- Implemented version management script (`scripts/version.sh`)
- Configured Docker metadata action for consistent tagging
- Added multi-platform Docker builds

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