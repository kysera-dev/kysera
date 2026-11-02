# Build from the repository root: docker build -f apps/cli/Dockerfile .
# Pin NODE_IMAGE to an approved digest in a release pipeline.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
FROM ${NODE_IMAGE} AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
RUN corepack enable && pnpm --filter . --filter @kysera/cli... install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@kysera/cli...
RUN pnpm --filter @kysera/cli --prod deploy /runtime && node /runtime/dist/index.js --version

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client default-mysql-client sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node /app/dist/index.js --version
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--help"]
