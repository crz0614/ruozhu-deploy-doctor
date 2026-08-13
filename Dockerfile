FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
ENV PORT=3000 NODE_ENV=production DATABASE_FILE=/app/.data/deploy-doctor.db
EXPOSE 3000
CMD ["node", "src/server.js"]
