# syntax=docker/dockerfile:1
# Luma Studio — ONE image that runs everything (api + SPA + agent runner + renderer).

# ---- build: SPA + api ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- shared base packages every project reuses (no per-project npm install needed) ----
FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /opt/luma
COPY docker/runtime-deps/package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime: Playwright image gives us Chromium + its system deps ----
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS runtime
ENV NODE_ENV=production DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git poppler-utils curl jq ca-certificates bubblewrap util-linux \
      fonts-noto fonts-noto-core fonts-noto-color-emoji fonts-beng-extra fonts-inter \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf "$(find /ms-playwright -path '*chrome-linux*/chrome' -type f | head -n1)" /usr/local/bin/chromium

# unprivileged user that runs agent commands (the api itself runs as root:app so it can chown/drop)
RUN useradd --system --create-home --uid 2000 luma

COPY --from=runtime-deps /opt/luma/node_modules /opt/luma/node_modules
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
COPY template ./template
COPY packages/prompts ./prompts

ENV PORT=8080 DATA_DIR=/data WEB_DIST=/app/web CHROME_PATH=/usr/local/bin/chromium \
    NODE_PATH=/opt/luma/node_modules LUMA_TEMPLATE_DIR=/app/template LUMA_PROMPTS_DIR=/app/prompts
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
