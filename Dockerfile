FROM node:20-alpine

RUN apk add --no-cache gifsicle ffmpeg

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

CMD ["npm", "start"]
