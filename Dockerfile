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
    unzip && \
    rm -rf /var/cache/apk/* && \
    update-ca-certificates

# Install Deno (minimum version 2.0.0 required)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Install yt-dlp with [default] extras (includes yt-dlp-ejs)
RUN pip3 install --no-cache-dir "yt-dlp[default]" --break-system-packages && \
    rm -rf /root/.cache

# Create yt-dlp config directory and enable remote components as fallback
RUN mkdir -p /root/.config/yt-dlp && \
    echo "--remote-components ejs:npm" > /root/.config/yt-dlp/config

# Verify installations
RUN deno --version && \
    yt-dlp --version && \
    python3 -c "import yt_dlp_ejs; print(f'yt-dlp-ejs version: {yt_dlp_ejs.__version__}')"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts \
    && npm cache clean --force

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server files
COPY server ./server

# Create necessary directories
RUN mkdir -p /app/data /app/download

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000

# Health check
HEALTHCHECK --interval=5m --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

# Run as non-root user for security
USER node

# Start the application
CMD ["node", "server/index.js"]
