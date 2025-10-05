# Use Debian-based Node.js image
FROM node:20-alpine

# Install dependencies for yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
	ca-certificates \
	openssl \
	bash

# Update CA certificates
RUN update-ca-certificates

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp --break-system-packages

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy application files
COPY . .

# Build frontend with Vite
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create data and download directories
RUN mkdir -p /app/data /app/download

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=5m --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:3000/ || exit 1

# Start the application
CMD ["node", "server/index.js"]
