import { hc } from "hono/client"
import type { AppType } from "../../../server/src/app.js"

/**
 * The typed client for Night Code's own API.
 *
 * `hc<AppType>` reads the route table straight off the server's app, so a URL that does not exist or
 * a payload the route rejects fails `bun run typecheck` instead of failing in front of a user.
 */
export const apiClient = hc<AppType>(baseUrl())

function baseUrl(): string {
  return process.env.NIGHTCODE_SERVER_URL ?? "http://localhost:3000"
}
