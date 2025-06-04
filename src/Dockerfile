# Use Node.js Alpine
FROM node:18-alpine

RUN apk add --no-cache ffmpeg curl ca-certificates python3 bash
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp
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

HEALTHCHECK --interval=5m --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["node", "index.js"]