# Deployment candidate; verify the built image before using for judge access.
FROM node:22.16.0-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run typecheck && npm run build

FROM node:22.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# API workspace exports currently use TypeScript source and tsx; do not prune dev deps.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/fairshare && chown node:node /var/lib/fairshare
USER node
EXPOSE 3001 3000
CMD ["npm", "run", "start", "-w", "@fairshare/api"]
