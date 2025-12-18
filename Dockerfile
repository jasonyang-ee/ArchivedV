FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build frontend
RUN npm run build




FROM node:24-alpine AS runtime

# Install system dependencies (Node.js already included!)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates \
    openssl \
    curl && \
    rm -rf /var/cache/apk/* && \
    update-ca-certificates

# Install yt-dlp with [default] extras (includes yt-dlp-ejs)
RUN pip3 install --no-cache-dir "yt-dlp[default]" --break-system-packages && \
    rm -rf /root/.cache

# Verify installations
RUN node --version && \
    npm --version && \
    yt-dlp --version && \
    python3 -c "import yt_dlp_ejs; print('yt-dlp-ejs installed successfully')"

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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "server/index.js"]