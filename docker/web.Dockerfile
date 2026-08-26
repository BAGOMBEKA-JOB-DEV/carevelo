# One image for all four Next.js apps. The app is chosen at run time by the
# compose command, because they share a pnpm workspace and a lockfile: building
# four images would install the same dependency tree four times.
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app

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
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
