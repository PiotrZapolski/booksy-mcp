# Image for MCP directories and registries that inspect the server: it starts on stdio and answers
# initialize and tools/list with no browser. Real use needs Chrome with the extension on the same
# computer, so run the server from the MCP Bundle or from source there (see README, Install).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY extension ./extension
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/PiotrZapolski/booksy-mcp"
LABEL org.opencontainers.image.licenses="MIT"
LABEL io.modelcontextprotocol.server.name="io.github.PiotrZapolski/booksy-mcp"
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/extension/dist ./extension/dist
COPY LICENSE README.md ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
