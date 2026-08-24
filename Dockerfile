FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli git tini
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /app/.data /workspaces && chown -R node:node /app /workspaces
USER node
ENV PORT=3000 NODE_ENV=production WORKSPACE_ROOT=/workspaces
EXPOSE 3000
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node", "src/server.js"]
