# syntax=docker/dockerfile:1
#
# The four Next.js apps. One image; the app is chosen at run time by the compose
# command, and all four services pin `image: carevelo-web:dev` so Compose builds
# it once rather than four times.
#
# ============================================================================
# THIS IMAGE INSTALLS NOTHING. THAT IS THE WHOLE DESIGN.
# ============================================================================
#
# It runs against the host's `frontend/node_modules`, mounted by compose. An
# earlier version installed its own, and on a slow connection it never finished:
# 377 packages at 9-42 KiB/s, dying on `TimeoutError` after five minutes, three
# builds running.
#
# WHY IT COULD NOT SIMPLY USE THE HOST'S. This was `node:22-alpine`, which is
# musl. The host is glibc, and its node_modules carries `linux-x64-gnu` native
# builds. Those are not interchangeable, so the container had to fetch the musl
# equivalents -- which is precisely what the build logs choked on:
# @next/swc-linux-x64-musl, lightningcss-linux-x64-musl,
# @rolldown/binding-linux-x64-musl, @swc/core-linux-x64-musl.
#
# `node:22` is Debian and glibc, so it matches the host and the mount just works.
# Alpine was a habit -- smaller images -- and it cost far more than it saved.
#
# THE TRADE, said plainly: this image is NOT self-contained. It needs the host's
# node_modules mounted, so it is a development stack and nothing else. Run
# `pnpm install` in frontend/ once before `docker compose up`. A production image
# installs its own dependencies; see the foot of docker-compose.yml.
FROM node:22

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app

# Kept for the day somebody builds this on a fast link and wants a self-contained
# image: fewer parallel fetches finish sooner on a thin one, because pnpm's
# default of sixteen puts every stream under the 50 KiB/s floor it warns about.
RUN printf '%s\n' \
      'network-concurrency=4' \
      'fetch-retries=5' \
      'fetch-retry-maxtimeout=600000' \
      'fetch-timeout=600000' \
      > /root/.npmrc

# Playwright's browsers are ~150 MB this image never opens: it runs `next dev`,
# and the browser tests run on a developer's machine against a stack already up.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# No COPY and no install. The source and its node_modules arrive as mounts.
