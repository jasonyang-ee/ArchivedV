# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm prune --production



# Runtime stage
FROM node:18-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache ffmpeg curl ca-certificates bash \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
     -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

COPY --from=builder /app .
RUN mkdir -p data download

USER 1000
EXPOSE 3000

HEALTHCHECK --interval=5m --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["node", "index.js"]