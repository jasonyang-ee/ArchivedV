[![DockerPublish](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml/badge.svg)](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml)

# Unarchived V

A self-hosted YouTube stream download service with keyword filtering. The service automatically checks subscribed channels for new live streams, downloads matching videos to a specified directory, and sends notifications via Pushover.

The purpose of this project is to save vtuber singing streams where often are unarchived due to copyright issues.

![main page](doc/mainpage.png)

## Public Docker Image

> jasonyangee/archivedv:latest

> ghcr.io/jasonyangee/archivedv:latest

## Run using Docker Compose

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
      - ./archivedv/video/path:/app/download
    environment:
      PUSHOVER_APP_TOKEN: ${PUSHOVER_APP_TOKEN}
      PUSHOVER_USER_TOKEN: ${PUSHOVER_USER_TOKEN}
      TZ: America/Los_Angeles
```

## Data Persistence

Bind mounts to preserve data:

- **Configuration & History**: stored in the `/app/data/db.json`
- **Downloads**: saved under `/app/download/<channel_username>/<video_title>/`.

## Scheduling

A cron job runs every 10 minutes to check for new live streams.

## Notifications (Optional)

Pushover is used to send mobile/desktop notifications on each successful download.
