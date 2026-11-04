FROM node:22-slim
# Chromium untuk Puppeteer (generate PDF)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY server.mjs templates/ ./
EXPOSE 8080
CMD ["node", "server.mjs"]
