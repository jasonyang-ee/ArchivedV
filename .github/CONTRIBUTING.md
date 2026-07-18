# Contributing

All contributions are welcome, including issues, suggestions, pull requests, and more.

## Submitting a Pull Request

Before you submit the pull request for review, please ensure that:

- The pull request naming follows the [Conventional Commits specification](https://www.conventionalcommits.org):

  `<type>[optional scope]: <description>`

  Example:
  ```
  feat: add support for mp4 video format
  fix: resolve memory leak in download queue
  docs: update installation instructions
  ```

  Where `TYPE` can be:
  - **feat** - a new feature
  - **fix** - a bug fix
  - **doc** - documentation only changes
  - **refactor** - code change that neither fixes a bug nor adds a feature
  - **test** - adding or updating tests
  - **ci** - changes to CI/CD workflows
  - **chore** - other changes that don't modify src or test files

- Your pull request has a detailed description of the changes
- You've tested your changes locally
- Your code follows the project's style conventions
- You've added tests for new features (if applicable)

## Development Environment

ArchivedV is a web application for downloading and archiving videos using yt-dlp.

### Dev Container (recommended)

The fastest way to get a working environment — no local Node.js, yt-dlp, or ffmpeg install needed:

1. Install [Docker](https://www.docker.com/products/docker-desktop), [VS Code](https://code.visualstudio.com/), and the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
2. Open the repository in VS Code and choose **Reopen in Container** when prompted (or run the `Dev Containers: Reopen in Container` command).
3. Dependencies install automatically on first open. Start the dev servers:
   ```bash
   npm run dev
   ```
4. The frontend is at `http://localhost:5173`, the backend API at `http://localhost:3000`.

### Local Setup

#### Prerequisites

- [Node.js](https://nodejs.org/en/download/) >= 24
- [Docker](https://www.docker.com/products/docker-desktop) for testing the complete stack
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) installed on your system for local testing

#### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonyang-ee/ArchivedV.git
   ```
   ```bash
   cd ArchivedV
   ```

#### Running Locally

- Start the server stack (Linux/macOS):
	```bash
	./start.sh
	```

- The frontend will start on `http://localhost:5173`
- The backend will start on `http://localhost:3000`

### Running with Docker

- Start the application using Docker Compose:
	```bash
	docker-compose up
	```
- The web interface is published on `http://localhost:7000` (host port 7000 maps to container port 3000).

### Building

**Build the frontend:**
```bash
npm run build
```

**Build the Docker image:**
```bash
docker build -t archivedv:latest .
```

**Build multi-platform Docker images:**
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/archivedv:latest .
```

### Testing

Run the unit test suite:

```bash
npm test
```

Verify the frontend still builds:

```bash
npm run build
```

Test the running application:

1. Start the server:
   ```bash
   npm start
   ```

2. Test the API endpoint:
   ```bash
   curl http://localhost:3000/api/status
   ```

3. Open the web interface:
   ```
   http://localhost:3000
   ```

### Environment Variables

All variables are optional and default sensibly (see `server/config.js` for the full list, and the commented examples in `docker-compose.yml`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Express server port |
| `TRUST_PROXY` | `1` | Express `trust proxy` setting; set `false` when not behind a proxy |
| `YTDLP_COOKIES_PATH` | `data/youtube_cookies.txt` | Netscape-format cookies file for yt-dlp auth |
| `PUSHOVER_APP_TOKEN` | empty | Pushover notification app token |
| `PUSHOVER_USER_TOKEN` | empty | Pushover notification user token |

### Code Style

We use [Prettier](https://prettier.io/) for code formatting via editor integration — the dev container ships with the Prettier extension preinstalled. Enable format-on-save in your editor.

## Releasing a New Version

For maintainers, releases are automated with the release script:

```bash
./release.sh            # auto-detect release type from commits
./release.sh --minor    # or --major, --patch
./release.sh --dry-run  # preview the release plan
```

This will:
- Run the test suite
- Bump the version in `package.json`
- Update `CHANGELOG.md`
- Create a git tag
- Create a GitHub draft release
- Trigger automated Docker builds and image publishing

Release types follow [Semantic Versioning](https://semver.org/): **major** for breaking changes, **minor** for new features (`feat:` commits), **patch** for bug fixes (`fix:` commits). Changes are tracked in `CHANGELOG.md` under `[Unreleased]` until released.

## Questions or Need Help?

- Open an issue for bug reports or feature requests
- Check existing issues and discussions before opening a new one
- Join our discussions on GitHub for general questions

Thank you for contributing to ArchivedV!
