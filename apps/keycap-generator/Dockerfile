# Build context MUST be the monorepo root (../..) because keycap-generator
# depends on pnpm workspace packages (@vostok/*) and on packages/manifold-noeval.
#
# Build:  docker build -f apps/keycap-generator/Dockerfile -t keycap-generator .
# Serve:  docker run -p 8080:80 keycap-generator

# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

# Pin the same pnpm as the repo's packageManager field (pnpm@10.8.1).
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

# Whole tree (minus what .dockerignore skips) so pnpm --frozen-lockfile can
# resolve every workspace project referenced by pnpm-lock.yaml.
COPY . .

# Install the full workspace (devDependencies included: vite lives there).
RUN pnpm install --frozen-lockfile

# Build just the keycap generator into apps/keycap-generator/dist.
RUN pnpm --filter keycap-generator build

# ---- Runtime stage -----------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/keycap-generator/dist /usr/share/nginx/html
COPY apps/keycap-generator/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]