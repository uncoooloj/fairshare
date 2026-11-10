# Build from repository root. No app secrets or user data are copied into the image.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
RUN npm ci --ignore-scripts
COPY apps/api/src ./apps/api/src
COPY apps/api/parser-container/server.ts ./apps/api/parser-container/server.ts
USER node
ENV NODE_ENV=production FAIRSHARE_PARSER_START=true
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/api/parser-container/server.ts"]
