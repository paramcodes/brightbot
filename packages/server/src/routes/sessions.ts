import { zValidator } from "@hono/zod-validator"
import type { Message, Session } from "@nightcode/shared"
import { Hono } from "hono"
import { z } from "zod"
import { caller } from "../middleware/auth.js"
import { ApiError, errorResponse } from "../middleware/error-handler.js"
import { createStore } from "../store/index.js"

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  model: z.string().min(1).max(100),
})

/**
 * Sessions are created and read back here. The route owns HTTP only: the validator parses the request
 * at the boundary, the port persists it, and the response is the stored record unchanged.
 *
 * Every read is scoped to the caller. A 404 rather than a 403 when a session belongs to someone else,
 * because a 403 would confirm that the id exists and the caller should learn nothing about it.
 */
export const sessions = new Hono()
  .post(
    "/",
    zValidator("json", createSessionSchema, (result, _c) =>
      result.success ? undefined : errorResponse(400, z.prettifyError(result.error)),
    ),
    async (c) => {
      const user = caller(c)
      if (user === null) throw new ApiError(401, "The request carries no session that this server issued")
      const input = c.req.valid("json")
      const store = await createStore()
      // The row exists before the session does, so a session for a caller who has never been seen here
      // is a foreign key waiting to fail rather than a first-turn surprise.
      await store.ensureUser(user)
      return c.json<Session>(await store.createSession({ ...input, userId: user.id }), 201)
    },
  )
  .get("/", async (c) => {
    const user = caller(c)
    if (user === null) throw new ApiError(401, "The request carries no session that this server issued")
    const store = await createStore()
    return c.json<Session[]>(await store.listSessions(user.id))
  })
  .get("/:id", async (c) => {
    const user = caller(c)
    const id = c.req.param("id")
    const store = await createStore()
    const session = await store.getSession(id)
    // A 404 rather than an empty array, which is the answer `GET /:id` already gives: a caller that
    // asked for a session that is not there has made a mistake, and an empty transcript would read as
    // a session that had simply never been spoken in.
    if (!session || user === null || session.userId !== user.id) {
      throw new ApiError(404, `No session with id ${id}`)
    }
    return c.json<Session>(session)
  })
  .get("/:id/messages", async (c) => {
    const user = caller(c)
    const id = c.req.param("id")
    const store = await createStore()
    const session = await store.getSession(id)
    // A 404 rather than an empty array, which is the answer `GET /:id` already gives: a caller that
    // asked for a session that is not there has made a mistake, and an empty transcript would read as
    // a session that had simply never been spoken in.
    if (!session || user === null || session.userId !== user.id) {
      throw new ApiError(404, `No session with id ${id}`)
    }
    return c.json<Message[]>(await store.listMessages(id))
  })
