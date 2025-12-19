[![DockerPublish](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml/badge.svg)](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml)
[![Testing](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/testing.yml/badge.svg)](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/testing.yml)
[![Release](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/release.yml/badge.svg)](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/release.yml)


<h1 align="center">(Un)Archived V</h1>
<h3 align="center">Youtube Stream Download Service With Keyword Filtering.</h3>
<p align="center"><img src="doc/Logo.png" alt="Logo" /></p>



## Main Purpose:

The purpose of this project is to save Vtuber singing streams where often are unarchived due to copyright issues.


## Service Feature:

1. Automatically check subscribed channels for new live streams.
2. Download matching videos based on a specified keyword list.
3. Send notifications via Pushover.
4. Manage channels and keywords via the web interface.


## Screenshot

![main page](doc/screenshot.png)

## Public Tracking Service

This service is tracking all EN and ID branch. Video will be periodically deleted to free up space.

https://archivedv.jasony.org

## Public Docker Image

>[Docker Hub](https://hub.docker.com/r/jasonyangee/archivedv)
```
jasonyangee/archivedv:latest
```

>[GitHub Container Registry](https://github.com/jasonyang-ee/ArchivedV/pkgs/container/archivedv)
```
ghcr.io/jasonyang-ee/archivedv:latest
```

## Supported Platforms
- Linux AMD64
- Linux ARM64

## Run Using Docker Compose

```yaml
services:
  archivedv:
    image: jasonyangee/archivedv:latest
    container_name: archivedv
    restart: unless-stopped
    user: "1000:1000"
    ports:
      - "3000:3000"
    volumes:
      - ./archivedv/data:/app/data
      - ./archivedv/video:/app/download
    environment:
      TZ: America/Los_Angeles
      # PUSHOVER_APP_TOKEN: ${PUSHOVER_APP_TOKEN}
      # PUSHOVER_USER_TOKEN: ${PUSHOVER_USER_TOKEN}
```

## 🏗️ Development & Deployment

### Versioning Strategy

This project uses **Semantic Versioning** managed through `package.json`. All releases are automated via GitHub Actions.

- **MAJOR.MINOR.PATCH** format (e.g., `1.2.3`)
- Versions are automatically bumped and tagged
- Docker images are built for multiple platforms (AMD64/ARM64)

### CI/CD Pipeline

The project includes comprehensive CI/CD with three main workflows:

#### 🔄 Testing Workflow
- **Trigger**: Push to any branch
- **Purpose**: Build test images and validate functionality
- **Jobs**: Build, test container health, API validation, frontend build

#### 🚀 Release Workflow
- **Trigger**: Version tags (`v*.*.*`) or manual dispatch
- **Purpose**: Production deployment with semantic versioning
- **Jobs**: Full test suite, multi-platform Docker build, GitHub release

#### ✅ PR Validation
- **Trigger**: Pull requests to main/master
- **Purpose**: Code quality assurance
- **Jobs**: Linting, build verification, quick container tests

### Version Management

#### Automated Release (Recommended)
```bash
# Bump version and create release
./scripts/version.sh patch    # or minor/major
git add package.json package-lock.json
git commit -m "chore: bump version to x.y.z"
git push
git tag vx.y.z
git push --tags
```

#### Manual Release via GitHub Actions
1. Go to **Actions** → **Release** → **Run workflow**
2. Select version bump type
3. The workflow handles everything automatically

### Required GitHub Secrets
- `USERNAME_DOCKERHUB`: Docker Hub username
- `TOKEN_DOCKERHUB`: Docker Hub access token
- `TOKEN_GITHUB`: GitHub personal access token

For detailed versioning and deployment instructions, see [VERSIONING.md](VERSIONING.md).

## Web Interface

Access the web interface at `http://<host_ip>:3000`

## Data Persistence

Bind mounts to preserve data:

- **Configurations**: `/app/data/db.json`
- **Downloaded Videos**: `/app/download/<channel_username>/[DateTime] <video_title>/`

## Scheduling

A cron job runs every 10 minutes to check for new live streams.

## Notifications (Optional)

[Pushover](https://pushover.net/) is used to send mobile/desktop notifications on each successful download.

## Folder Permissions

It is recommended to run the container with a non-root user. The default user ID is `1000`.

Change to the user ID of your host system if necessary. You can do this by modifying the `user` field in the Docker Compose file.

## Potential Issues

- Folder permissions may cause issues. Please manually `chown` the volume bind folders to the user ID specified in the Docker Compose file.

	> Example Command
	```bash
	sudo chown -R 1000:1000 ./archivedv
	```

- Axios need ipv4 to work properly. Force ipv4 dns resolution by adding the following to your docker compose file:
	```yaml
	services:
	  archivedv:
	    image: jasonyangee/archivedv:latest
	    container_name: archivedv
	    restart: unless-stopped
	    user: "1000:1000"
	    ports:
	    - "3000:3000"
	    volumes:
	    - ./archivedv/data:/app/data
	    - ./archivedv/video:/app/download
	    environment:
	    TZ: America/Los_Angeles
	    NODE_OPTIONS: "--dns-result-order=ipv4first"
	    dns:
	    - 8.8.8.8
	    - 1.1.1.1
	    sysctls:
	    - net.ipv6.conf.all.disable_ipv6=1
	```