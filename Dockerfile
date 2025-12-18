FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install ALL dependencies (needed for build)
RUN npm ci --ignore-scripts

# Copy source files
COPY . .

# Build frontend with Vite
RUN npm run build




FROM node:24-alpine AS runtime

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates \
    openssl \
    curl \
    nodejs \
    npm && \
    rm -rf /var/cache/apk/* && \
    update-ca-certificates

# Install Deno (set PATH in same RUN command)
RUN curl -fsSL https://deno.land/install.sh | sh && \
    /root/.deno/bin/deno --version

# Set Deno environment variables for subsequent layers
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Install yt-dlp with [default] extras (includes yt-dlp-ejs)
RUN pip3 install --no-cache-dir "yt-dlp[default]" --break-system-packages && \
    rm -rf /root/.cache

# Create yt-dlp config directory and enable remote components as fallback
RUN mkdir -p /root/.config/yt-dlp && \
    echo "--remote-components ejs:npm" > /root/.config/yt-dlp/config

# Verify installations (PATH is now set via ENV)
RUN deno --version && \
    yt-dlp --version && \
    python3 -c "import yt_dlp_ejs; print(f'yt-dlp-ejs version: {yt_dlp_ejs.__version__}')"

# Set working directory
WORKDIR /app

# Copy built frontend and server files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY server ./server

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Create necessary directories
RUN mkdir -p /app/data /app/download

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server/index.js"]