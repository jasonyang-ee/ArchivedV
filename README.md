[![DockerPublish](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml/badge.svg)](https://github.com/jasonyang-ee/ArchivedV/actions/workflows/publish.yml)

# (Un)Archived V

A self-hosted YouTube stream download service with keyword filtering. The service automatically checks subscribed channels for new live streams, downloads matching videos to a specified directory, and sends notifications via Pushover.

The purpose of this project is to save vtuber singing streams where often are unarchived due to copyright issues.

![main page](doc/mainpage.png)

## Public Docker Image

> jasonyangee/archivedv:latest

> ghcr.io/jasonyang-ee/archivedv:latest

## Run Using Docker Compose

```yaml
services:
  vtuber:
    image: jasonyangee/archivedv:latest
    container_name: archivedv
    restart: unless-stopped
    user: "1000:1000"
    ports:
      - "3000:3000"
    volumes:
      - ./vtuber/data:/app/data
      - ./vtuber/video:/app/download
    environment:
      TZ: America/Los_Angeles
      # PUSHOVER_APP_TOKEN: ${PUSHOVER_APP_TOKEN}
      # PUSHOVER_USER_TOKEN: ${PUSHOVER_USER_TOKEN}
```

## Web Interface

Access the web interface at `http://<host_ip>:3000`

## Data Persistence

Bind mounts to preserve data:

- **Configurations**: `/app/data/db.json`
- **Downloaded Videos**: `/app/download/<channel_username>/<video_title>/`

## Scheduling

A cron job runs every 10 minutes to check for new live streams.

## Notifications (Optional)

Pushover is used to send mobile/desktop notifications on each successful download.

## Folder Permissions

It is recommended to run the container with a non-root user. The default user ID is `1000`.

Change to the user ID of your host system if necessary. You can do this by modifying the `user` field in the Docker Compose file.