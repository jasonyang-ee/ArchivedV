FROM node:24-trixie AS dev

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

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code (will be overridden by volume mount in dev)
COPY . .

# Expose port
EXPOSE 3000

# Default command for development
CMD ["npm", "run", "dev"]