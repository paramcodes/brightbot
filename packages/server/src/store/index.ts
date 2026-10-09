import type { Store } from "@nightcode/shared"
import { FileStore } from "./file-store.js"
import { prismaStore } from "./prisma-store.js"
import type { StoreKind } from "./types.js"

/**
 * The single place a store implementation is chosen.
 *
 * It is a pure read of the environment so the choice can be tested without booting a database, and so
 * no route ever imports a concrete store.
 */
export function resolveStoreKind(environment: Record<string, string | undefined>): StoreKind {
  return environment.DATABASE_URL ? "prisma" : "file"
}

let cached: { kind: StoreKind; store: Store } | null = null

/**
 * One store per process. `DATABASE_URL` is a boot-time decision, and memoizing keeps a Prisma client
 * from being rebuilt per request. A `FileStore` holds no state of its own, so sharing one is free.
 */
export async function createStore(): Promise<Store> {
  const kind = resolveStoreKind(process.env)
  if (!cached || cached.kind !== kind) {
    cached = { kind, store: kind === "prisma" ? await prismaStore() : new FileStore() }
  }
  return cached.store
}
