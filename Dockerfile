# Use Node.js Alpine
FROM node:18-alpine

ARG TARGETPLATFORM

RUN apk add --no-cache ffmpeg curl ca-certificates python3 bash

RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; \
	then curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp \
	elif [ "$TARGETPLATFORM" = "linux/arm64" ]; \
	then curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64 -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp \
	elif [ "$TARGETPLATFORM" = "linux/arm/v7" ]; \
	then curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_armv7l -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

ENV PATH="/usr/local/bin:${PATH}"
WORKDIR /app

# ensure data folder exists
RUN mkdir -p /app/data /app/download

# Install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy all code
COPY . .

# Expose and start
USER 1000
EXPOSE 3000
CMD ["node", "index.js"]