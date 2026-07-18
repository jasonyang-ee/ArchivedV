FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 \
	python3-pip \
	ffmpeg \
	ca-certificates \
	openssl \
	curl && \
	apt-get clean && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with [default] extras
RUN pip3 install --no-cache-dir "yt-dlp[default]" --break-system-packages && \
    rm -rf /root/.cache

# Verify installations
RUN node --version && \
    npm --version && \
    yt-dlp --version && \
    python3 -c "import yt_dlp_ejs; print('yt-dlp-ejs installed successfully')"

# Pre-create node_modules owned by node so the named volume inherits that
# ownership on first mount (deps installed by postCreateCommand)
RUN mkdir -p /app/node_modules && chown -R node:node /app

WORKDIR /app

EXPOSE 3000
