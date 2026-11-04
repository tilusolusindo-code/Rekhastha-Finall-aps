FROM node:22-alpine
RUN apk add --no-cache postgresql16-client gzip
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY backup.mjs ./
CMD ["node", "backup.mjs"]
