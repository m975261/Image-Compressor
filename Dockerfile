FROM node:20-alpine

RUN apk add --no-cache gifsicle ffmpeg

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=4321
ENV DATA_PATH=/app/data

RUN mkdir -p /app/data

EXPOSE 4321

CMD ["npm", "start"]
