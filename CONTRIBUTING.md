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

ArchivedV is a web application for downloading and archiving videos using yt-dlp. To set up a local development environment, follow these steps:

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) >= 24
- [Docker](https://www.docker.com/products/docker-desktop) for testing the complete stack
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed on your system for local testing

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonyang-ee/ArchivedV.git
   ```
   ```bash
   cd ArchivedV
   ```

### Running Locally

- Start the server stack:
	> Linux
	```bash
	./start.sh
	```
	> Windows
	```bash
	start.bat
	```

- The frontend will start on `http://localhost:5173`
- The backend will start on `http://localhost:3000`

### Running with Docker

- Start the application using Docker Compose:
	```bash
	docker-compose up
	```

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

Test the application locally:

1. Ensure the application is running:
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

4. Test with Docker:
   ```bash
   docker-compose up
   docker-compose exec app npm run test
   ```

### Code Style

We use [Prettier](https://prettier.io/) for code formatting. Before committing, run:

```bash
npm run format
```

Or enable auto-formatting in your editor.

### Commit Hooks

We recommend using [husky](https://typicode.github.io/husky/) to automatically lint and format your code before committing. After cloning, you can set it up with:

```bash
npm install husky --save-dev
npx husky install
```

## Releasing a New Version

Releases are automated using our release script. See [VERSIONING.md](VERSIONING.md) for detailed instructions.

For maintainers, the release process is:

```bash
./scripts/create-release.sh --minor  # or --major, --patch
```

This will:
- Bump the version in `package.json`
- Update `CHANGELOG.md`
- Create a git tag
- Create a GitHub draft release
- Trigger automated Docker builds and image publishing

## Questions or Need Help?

- Open an issue for bug reports or feature requests
- Check existing issues and discussions before opening a new one
- Join our discussions on GitHub for general questions

Thank you for contributing to ArchivedV!
