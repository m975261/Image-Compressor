FROM node:20-alpine

RUN apk add --no-cache gifsicle ffmpeg imagemagick wget

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install ALL deps for build
RUN npm ci

# Copy source
COPY . .

# Build (if applicable)
RUN npm run build

# Remove dev dependencies AFTER build
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=4321
ENV DATA_PATH=/app/data

RUN mkdir -p /app/data && chmod -R 755 /app/data

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:4321/api/health || exit 1

CMD ["npm", "start"]
