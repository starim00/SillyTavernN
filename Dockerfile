FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/legacy-host/package.json apps/legacy-host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/extension-sdk/package.json packages/extension-sdk/package.json
COPY packages/legacy-compat/package.json packages/legacy-compat/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/storage/package.json packages/storage/package.json

RUN npm ci

COPY . .

ARG STN_LEGACY_PUBLIC_ORIGIN=http://localhost:4711
ENV VITE_STN_LEGACY_ORIGIN=${STN_LEGACY_PUBLIC_ORIGIN}

RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/legacy-host/package.json ./apps/legacy-host/package.json
COPY --from=build /app/apps/legacy-host/dist ./apps/legacy-host/dist
COPY --from=build /app/packages ./packages

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

FROM nginx:1.29-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/client /usr/share/nginx/html
