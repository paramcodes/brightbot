# Phase 6 design: Browser-to-CLI OAuth & User Security

Phase 6 of `tools/plan.json` (issue #29). This file records the structural decisions and where they
deviate from the plan.

## Problem

The CLI has no identity and the server has no notion of a caller. `Store` allocates `LOCAL_USER_ID`
for every session, `listSessions` returns every row in the document, and every route answers whoever
asks. A login flow that cannot be finished without a browser, a credential that must not sit in a
world-readable file, and a caller that every route can see are the three things this phase has to
make true at once.

The plan names Clerk. No Clerk key exists on this machine, and standing order 5 forbids a code path
that needs one, so the local provider is what actually runs and Clerk is the optional adapter behind
the same port. The plan also names `@clerk/clerk-js`-shaped calls; the shape used here is the OAuth
2.1 native flow over PKCE, which is what a CLI can complete without a browser at all.

## Shape

### One port in shared, two halves that meet on the wire

`shared/src/ports/auth.ts` holds the shapes both processes speak and nothing else. It is derived
from the environment the same way `resolveStoreKind` and `resolveModelKind` are, so the choice is a
pure function and a test needs no credentials:

```ts
export function resolveAuthKind(environment): AuthProviderKind {
  return environment.CLERK_PUBLISHABLE_KEY ? "clerk" : "local"
}
```

The client half is two pure functions, `authorizeUrl` and `tokenUrl`, because the browser is sent
straight to the authorize endpoint and the code is exchanged against a URL. A pure function can be
asserted against a literal, which an SDK call cannot. The server half is the `AuthProvider` port with
`authorize`, `exchange`, and `verify`, and Hono wires the two HTTP routes that the client's two
functions point at.

The reason the port lives in shared rather than in each package is the wire. `AuthorizeInput` and
`ExchangeInput` are the same records on both sides, so a field added to one is a compile error in the
other rather than a `400` a user finds.

### PKCE and the loopback are the only moving parts on the client

`auth/pkce.ts` builds a verifier from 32 random bytes and the S256 challenge over its SHA-256. Both
are base64url, because that is what RFC 7636 requires and what makes the challenge safe to put in a
URL.

`auth/loopback-server.ts` binds `127.0.0.1` on port `0`, answers exactly one request, and stops. The
port is zero because a fixed port collides with a second login, and the host is loopback because a
callback that arrived from anywhere else is not this login. A second connection after the first is
refused by the closed server, which is the proof that one code goes to one client.

The redirect URI is validated on the server, not trusted, because the authorize endpoint would
otherwise be an open redirector. A non-loopback `redirect_uri` is a `400` before any code exists.

### The token is an HMAC over a JSON payload

`auth/token.ts` signs `{ sub, iat }` with `NIGHTCODE_AUTH_SECRET` and verifies with a constant-time
compare. There is no `exp`, so `expiresAt` is `null` and the session lives until it is deleted. An
expiring token with no refresh flow is a session that dies mid-turn with no way to recover it, and
the plan does not ask for one.

The default secret is a named development constant. It is a real weakness and it is recorded rather
than hidden: a deployed server with no `NIGHTCODE_AUTH_SECRET` accepts a token anyone can forge.
Phase 9 hardens this by refusing to boot without one.

### The middleware attaches the caller and the local default does not demand one

`middleware/auth.ts` resolves the bearer token into a user and sets it on the context. With the local
provider a request that carries no token is still the local user, because the whole local default
runs with no credentials and `bun run dev` has to answer a prompt. With Clerk configured a request
with no token, or one that fails verification, is a `401`.

This is the one place the phase deliberately does not do what the plan says. The plan's 6.4 rejects
unauthenticated requests outright. Rejecting them under the local provider would make the first
prompt of a fresh checkout fail, which standing order 5 forbids, and the PTY harness that proves every
commit would boot a CLI that cannot chat. The 401 path is real and proved for the configured case.

### The caller is written into the store

`NewSession` gains `userId`, `Store` gains `listSessions(userId)` and `ensureUser(user)`.

`listSessions(userId)` is the whole point of the phase: the listing route now answers one caller's
sessions rather than every row in the document. `ensureUser` exists because a caller from Clerk has
no row, and the Prisma schema has a foreign key from session to user, so creating a session for a
stranger would fail at the database rather than at the boundary. The file store upserts by id; the
Prisma store calls `upsert`, which its injected client already has.

Reads of one session check ownership at the route and answer `404` rather than `403`, because a `403`
confirms that someone else's session id exists.

## What this phase deliberately does not do

- No `session.update`. `updatedAt` stays write-once and "recent" means newest created, so ownership
  of a row never moves.
- No token refresh and no expiry. A session is deleted with `nightcode logout` and nothing else ends
  it.
- No Clerk account creation, and no Clerk session in the CLI's own vocabulary. The adapter translates
  the wire and nothing more.
- No pagination on either listing. That is still the first session with a thousand turns.
- No new status bar and no second search implementation. `/login` and `/logout` are palette commands,
  and the signed-in identity is one more cell in the header that already renders mode, model, and
  status.

## What this phase left behind

- `NIGHTCODE_AUTH_SECRET` has a development default. A deployed server without one accepts forged
  tokens. Phase 9 refuses to boot in that state.
- The Clerk adapter is selected by the shared `resolveAuthKind` and its URLs are built by
  `authorizeUrl` and `tokenUrl`, but no Clerk JWKS verifier is written yet. The 401 path is proved by
  a provider that refuses a tokenless request, not by a live Clerk login, because no Clerk instance
  exists on this machine. Phase 7 writes the verifier beside the credit meter, which is the other
  thing that needs a hosted identity.
- The authorize code lives in process memory, so a server restart invalidates a login that is
  halfway through the browser round trip. The user sees a failed exchange and runs login again.
- `listMessages` still takes only a session id. Ownership is checked by the caller of it, which is
  two routes today and would be three the day a third route reads a transcript.
- `analyze`: no `/logout` command ships in this phase. `nightcode login` writes the token and the
  user deletes `~/.nightcode/auth.json` until a `nightcode logout` lands with the palette entries.

## Verification

Each commit is proved by `tools/verify-commits.sh` in its own worktree. The login flow is the one
part that needs more than a unit test, so it is driven end to end against a real `Bun.serve` on port
`0` with a real loopback server and a no-op browser opener, and the token file's mode is read back off
disk. The real-terminal drive runs `nightcode login` through `tools/cli-pty.py` with `NIGHTCODE_HOME`
pointed at the run directory, so the operator's own `~/.nightcode` is never written.
