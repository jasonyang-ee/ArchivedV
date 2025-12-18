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
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates openssl curl && \
    rm -rf /var/cache/apk/* && \
    update-ca-certificates

# Install yt-dlp with default extras
RUN pip3 install --no-cache-dir "yt-dlp[default]" --break-system-packages && \
    rm -rf /root/.cache

# Install Deno
RUN curl -fsSL https://deno.land/x/install/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

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
