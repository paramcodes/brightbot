# Dependency decisions that differ from the plan

The plan was written against older major versions. These are the current facts, verified on this machine
on 2026-10-09, and the calls taken because of them.

| Plan says | Now | Decision |
| --- | --- | --- |
| Prisma with `url = env("DATABASE_URL")` in the datasource | Prisma 7 rejects that shape (`P1012`). The datasource carries only the provider; the connection comes from an adapter or `prisma.config.ts` | Prisma 7 style. `prisma generate` runs offline with no `DATABASE_URL`, so codegen works in CI and in a cold clone |
| `packages/server` holds the client | Generated output is a sibling directory, so it must be gitignored and generated at install | `packages/server/prisma/schema.prisma` ships; `packages/server/generated` is ignored and built by a postinstall |
| Sentry middleware for Hono | `@sentry/core` 11.6 with a hand-rolled Hono middleware is lighter than `@sentry/node` on Bun | `@sentry/core`, strict boundary: no-op unless `SENTRY_DSN` is set |
