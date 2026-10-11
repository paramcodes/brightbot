# The server image.
#
# Two properties this file has to hold, and both are about what it does not need. It builds in a cold
# clone with no `DATABASE_URL`, because `prisma generate` runs offline in the postinstall and
# `resolveStoreKind` falls back to the file store. And it starts on no secret, for the same reason.
# A container that required one to boot would be a container that could not be smoke-tested.
FROM oven/bun:1

WORKDIR /app
ENV NODE_ENV=production

# The manifests first, so a dependency change does not rebuild the source layer. All three are copied,
# not just the server's, because the lockfile resolves the whole workspace and a missing member makes
# `--frozen-lockfile` refuse rather than guess.
#
# The two root tsconfigs are copied here rather than with the source, because `prisma generate` runs in
# the postinstall below and reads the base config to resolve the whole workspace. It fails with
# "File '../../tsconfig.base.json' not found" without them, which is a build failure rather than a
# warning, and it was found by running the install in a scratch directory rather than assumed.
COPY package.json bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/server/package.json packages/server/package.json

# The Prisma schema is copied before the install rather than after, because `prisma generate` runs in
# the postinstall and reads it. Copying it later would leave the generated client out of the image.
COPY packages/server/prisma packages/server/prisma

RUN bun install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/server packages/server

# The store and the credit ledger both write under here. A volume is the operator's call, and the
# default keeps a container usable with no configuration at all.
ENV NIGHTCODE_HOME=/data
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "--cwd", "packages/server", "src/index.ts"]
