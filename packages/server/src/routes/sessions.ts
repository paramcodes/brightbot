import { zValidator } from "@hono/zod-validator"
import type { Message, Session } from "@nightcode/shared"
import { Hono } from "hono"
import { z } from "zod"
import { ApiError, errorResponse } from "../middleware/error-handler.js"
import { createStore } from "../store/index.js"

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  model: z.string().min(1).max(100),
})

/**
 * Sessions are created and read back here. The route owns HTTP only: the validator parses the request
 * at the boundary, the port persists it, and the response is the stored record unchanged.
 */
export const sessions = new Hono()
  .post(
    "/",
    zValidator("json", createSessionSchema, (result, _c) =>
      result.success ? undefined : errorResponse(400, z.prettifyError(result.error)),
    ),
    async (c) => {
      const input = c.req.valid("json")
      const store = await createStore()
      return c.json<Session>(await store.createSession(input), 201)
    },
  )
  .get("/", async (c) => {
    const store = await createStore()
    return c.json<Session[]>(await store.listSessions())
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id")
    const store = await createStore()
    const session = await store.getSession(id)
    if (!session) {
      throw new ApiError(404, `No session with id ${id}`)
    }
    return c.json<Session>(session)
  })
  .get("/:id/messages", async (c) => {
    const id = c.req.param("id")
    const store = await createStore()
    const session = await store.getSession(id)
    // A 404 rather than an empty array, which is the answer `GET /:id` already gives: a caller that
    // asked for a session that is not there has made a mistake, and an empty transcript would read as
    // a session that had simply never been spoken in.
    if (!session) {
      throw new ApiError(404, `No session with id ${id}`)
    }
    return c.json<Message[]>(await store.listMessages(id))
  })
