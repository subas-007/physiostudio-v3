FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Kathmandu DATA_DIR=/data/db UPLOAD_DIR=/data/uploads HOST=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tzdata sqlite3 curl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN useradd -r -u 10001 app && mkdir -p /data && chown -R app /data
USER app
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "src/server.js"]
