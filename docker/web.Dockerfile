# syntax=docker/dockerfile:1
#
# One image for all four Next.js apps. The app is chosen at run time by the
# compose command, because they share a pnpm workspace and a lockfile: building
# four images would install the same dependency tree four times. The compose
# file pins `image: carevelo-web:dev` on all four so Compose builds it once.
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# BUILT FOR A SLOW CONNECTION, because the first attempt at this died on one:
# tarballs at 9-42 KiB/s and `TimeoutError: The operation was aborted` after
# six and a half minutes of retries.
#
# `network-concurrency=4` is the setting that matters most, and it looks
# backwards. pnpm defaults to sixteen parallel requests; over a link this thin
# that is how EVERY one of them lands under the 50 KiB/s floor pnpm itself warns
# about. Four streams each get a usable share and the whole install finishes
# sooner than sixteen that all crawl.
#
# The timeouts are raised because the defaults assume a fast link and turn a slow
# success into a failure.
# ---------------------------------------------------------------------------
# WRITTEN AS A FILE RATHER THAN THROUGH `pnpm config set --global`, which refuses
# to run unless PNPM_HOME/bin is on PATH -- it wants to manage a shell profile,
# which a container image has no use for. The file is what that command would
# have produced, and pnpm reads it from the home directory whatever the workdir.
RUN printf '%s\n' \
      'store-dir=/pnpm/store' \
      'network-concurrency=4' \
      'fetch-retries=5' \
      'fetch-retry-maxtimeout=600000' \
      'fetch-timeout=600000' \
      > /root/.npmrc

# ~150 MB of Chromium this image will never open. `@playwright/test` is a ROOT
# devDependency, so it is pulled in by a workspace install, and installing it
# downloads a browser. This container runs `next dev`; the browser tests run on a
# developer's machine against a stack that is already up. The failing build spent
# real minutes retrying playwright-core and playwright for nothing.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# THE WHOLE WORKSPACE'S MANIFESTS FIRST. pnpm resolves across packages, so a
# partial copy would install a tree that does not match the lockfile, and
# --frozen-lockfile would then fail for a reason that is not the change.
COPY frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/package.json ./
COPY frontend/apps/patient-portal/package.json ./apps/patient-portal/
COPY frontend/apps/clinic-console/package.json ./apps/clinic-console/
COPY frontend/apps/rider-view/package.json ./apps/rider-view/
COPY frontend/apps/platform-admin/package.json ./apps/platform-admin/
COPY frontend/packages/ui/package.json ./packages/ui/
COPY frontend/packages/api-client/package.json ./packages/api-client/
COPY frontend/packages/realtime/package.json ./packages/realtime/

# A CACHE MOUNT, so a timeout costs the next attempt nothing it already fetched.
# Without it every failed build starts from zero, which on a slow link means the
# retry fails the same way -- that is what turned one bad build into a loop.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY frontend/ ./
