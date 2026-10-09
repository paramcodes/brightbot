import { PrismaPg } from "@prisma/adapter-pg"
import type { PrismaDatabase } from "../store/types.js"

/**
 * Where `prisma generate` writes the client, from `prisma/schema.prisma`'s `output = "../generated"`.
 *
 * It is a constant and not a literal inside `import()` on purpose. `tsc` resolves a literal specifier,
 * so writing the path inline would make `bun run typecheck` and `bun test` fail in any tree that has
 * never run `bun install`, which is exactly how `tools/verify-commits.sh` checks every commit. The
 * directory is gitignored by design: the package's own postinstall rebuilds it.
 */
const GENERATED_CLIENT = "generated/client.js"

/**
 * Prisma 7 connection. The datasource carries only the provider, so the URL becomes an adapter here
 * and is handed to the constructor.
 *
 * The cast to `PrismaDatabase` is the price of never importing a build artifact statically. What
 * keeps it true is that `prisma/schema.prisma` declares the same models `PrismaDatabase` names, and
 * `prisma generate` rewrites the artifact from that schema.
 */
export async function createPrismaClient(): Promise<PrismaDatabase> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set, so no Prisma client can be built")
  const { PrismaClient } = (await import(`../../${GENERATED_CLIENT}`)) as {
    PrismaClient: new (options: { adapter: unknown }) => PrismaDatabase
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}
