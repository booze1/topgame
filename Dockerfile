# The server bundle includes its runtime dependencies, so the final image is
# Node plus the built output - no node_modules, nothing to audit at runtime.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY decks ./decks
COPY public ./public
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Decks are read from disk at boot; public/cards carries the committed card
# photographs and their attribution manifest.
COPY --from=build /app/dist ./dist
COPY --from=build /app/decks ./decks
COPY --from=build /app/public ./public

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
