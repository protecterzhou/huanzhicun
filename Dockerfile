FROM node:24-alpine
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "--experimental-sqlite", "server/index.js"]
