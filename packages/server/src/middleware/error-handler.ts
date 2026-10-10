import type { ApiErrorBody } from "@nightcode/shared"
import { HTTPException } from "hono/http-exception"

const STATUS_CODE: Record<number, string> = {
  400: "BAD_REQUEST",
  402: "PAYMENT_REQUIRED",
  404: "NOT_FOUND",
  500: "INTERNAL_ERROR",
}

function codeForStatus(status: number): string {
  return STATUS_CODE[status] ?? "REQUEST_FAILED"
}

/** The one envelope every failure returns, whatever produced it. */
export function errorResponse(status: number, message: string): Response {
  const body: ApiErrorBody = { error: { code: codeForStatus(status), message } }
  return Response.json(body, { status })
}

/**
 * Thrown by a route when it refuses the request. The handler below maps it onto the same envelope a
 * thrown bug produces, so a client never has two error shapes to branch on.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/** Hono's not-found hook. A missing route is a predictable failure, not a surprise. */
export function apiNotFound(): Response {
  return errorResponse(404, "No route matches this request")
}

/**
 * `report` is passed in so this module never imports a transport, and only 5xx is reported because a
 * client mistake is not an incident.
 *
 * `ApiError` and Hono's own `HTTPException` carry a status and a message written for a client. Anything
 * else is a bug, so it becomes a 500 whose own message stays server-side: a stack trace or a
 * connection string must never reach a client.
 */
export function onApiError(report: (cause: unknown) => void): (error: unknown) => Response {
  return (error) => {
    const known = error instanceof ApiError || error instanceof HTTPException
    if (!known) {
      report(error)
      return errorResponse(500, "The server failed to handle this request")
    }
    if (error.status >= 500) report(error)
    return errorResponse(error.status, error.message)
  }
}
