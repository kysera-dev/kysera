# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy root package files
COPY package.json pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy workspace packages
COPY packages/ ./packages/
COPY apps/cli/ ./apps/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the CLI and dependencies
RUN pnpm --filter @kysera/cli... build

# Runtime stage
FROM node:20-alpine

# Install global dependencies
RUN apk add --no-cache \
    postgresql-client \
    mysql-client \
    sqlite

# Create non-root user
RUN addgroup -g 1001 -S kysera && \
    adduser -S kysera -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=kysera:kysera /app/apps/cli/dist ./dist
COPY --from=builder --chown=kysera:kysera /app/apps/cli/templates ./templates
COPY --from=builder --chown=kysera:kysera /app/apps/cli/package.json ./

# Copy necessary packages
COPY --from=builder --chown=kysera:kysera /app/packages/core/dist ./node_modules/@kysera/core/dist
COPY --from=builder --chown=kysera:kysera /app/packages/core/package.json ./node_modules/@kysera/core/

COPY --from=builder --chown=kysera:kysera /app/packages/repository/dist ./node_modules/@kysera/repository/dist
COPY --from=builder --chown=kysera:kysera /app/packages/repository/package.json ./node_modules/@kysera/repository/

COPY --from=builder --chown=kysera:kysera /app/packages/migrations/dist ./node_modules/@kysera/migrations/dist
COPY --from=builder --chown=kysera:kysera /app/packages/migrations/package.json ./node_modules/@kysera/migrations/

COPY --from=builder --chown=kysera:kysera /app/packages/audit/dist ./node_modules/@kysera/audit/dist
COPY --from=builder --chown=kysera:kysera /app/packages/audit/package.json ./node_modules/@kysera/audit/

COPY --from=builder --chown=kysera:kysera /app/packages/soft-delete/dist ./node_modules/@kysera/soft-delete/dist
COPY --from=builder --chown=kysera:kysera /app/packages/soft-delete/package.json ./node_modules/@kysera/soft-delete/

COPY --from=builder --chown=kysera:kysera /app/packages/timestamps/dist ./node_modules/@kysera/timestamps/dist
COPY --from=builder --chown=kysera:kysera /app/packages/timestamps/package.json ./node_modules/@kysera/timestamps/

# Install production dependencies only
COPY --from=builder /app/node_modules ./node_modules

# Switch to non-root user
USER kysera

# Create CLI symlink
RUN mkdir -p /home/kysera/.local/bin && \
    ln -s /app/dist/index.js /home/kysera/.local/bin/kysera && \
    chmod +x /app/dist/index.js

# Add to PATH
ENV PATH="/home/kysera/.local/bin:${PATH}"

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD kysera --version || exit 1

# Default command
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--help"]