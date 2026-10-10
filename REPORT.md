# Phase 6 report: Browser-to-CLI OAuth & User Security

Status: complete. Awaiting merge.

- Branch: `phase-6-auth`
- Base: `2bf4651` (the system-prompt fix, after Phase 5 merged)
- Five commits, each green in isolation through `tools/verify-commits.sh`

## Commits

| SHA | Subject |
| --- | --- |
| `0737697` | `docs: design phase 6, browser-to-cli oauth and user security` |
| `1bdac1d` | `feat(cli): catch an OAuth callback on a loopback port with a PKCE pair (#30)` |
| `8bdf54b` | `feat(server): issue and verify a local session token (#31)` |
| `506aaef` | `feat(cli): sign in through the browser and keep the token on disk (#32)` |
| `f12cf29` | `feat(server): scope every api call to the authenticated caller (#33)` |

## What was built

**6.1 The loopback and the PKCE pair.** `startLoopbackServer` binds `127.0.0.1` on port `0` and
answers exactly one code. `createPkce` builds the S256 pair; the challenge goes in the URL and the
verifier never leaves the process. The loopback is closed by an explicit `stop`, because closing it
while the browser's page is still being written resets the connection and the user is left with a
dead tab.

**6.2 The two endpoints.** `GET /oauth/authorize` issues a single-use code and redirects to the
loopback. `POST /oauth/token` spends that code with the verifier that answers its challenge. The
code is bound to the redirect it was issued for, spendable exactly once, and only a loopback redirect
is accepted, because this endpoint would otherwise be an open redirector handing out fresh codes.
The token is an HMAC over a JSON payload, verified with a constant-time compare before the payload is
parsed.

**6.3 `nightcode login`.** Builds the pair, starts the port, opens the browser, spends the code. The
token lands in `~/.nightcode/auth.json` at mode `0o600`, written atomically. `--url` prints the URL
instead of opening a browser, which is what a machine with no browser needs.

**6.4 The caller everywhere.** `requireAuth` reads the bearer token and puts the caller on the
request context, so no route parses an `Authorization` header. The store takes the caller:
`NewSession` carries `userId`, `listSessions(userId)` answers one caller's rows, and the reads of one
session check ownership and answer `404` rather than `403`, so a caller learns nothing about a row
that is not theirs.

## Decisions a reviewer should push on

**A tokenless request is the local user, not an error.** The plan's 6.4 rejects unauthenticated
requests. Rejecting them under the local default would make the first prompt of a fresh checkout
fail, which standing order 5 forbids, and the PTY harness that proves every commit would boot a CLI
that cannot chat. The 401 path is real and proved for a configured provider, which answers `null`
for a request with no token; the local provider answers with the local user. The distinction the
middleware does make is between *no token* and *a presented token that is not one this server
signed*, the second of which is always refused.

**`nightcode login` is a command, not a mode.** A login is a browser round trip with a printed URL.
Rendering a TUI to show "signed in" would be a surface that starts, does nothing, and exits.

**The token has no expiry.** An expiring token with no refresh flow is a session that dies mid-turn
with no way to recover it, and the plan does not ask for one.

**The default signing secret is a named development constant.** A server reachable by anyone else
and holding no `NIGHTCODE_AUTH_SECRET` accepts a token anyone can forge. That is called out in the
design doc and left behind for Phase 9, rather than hidden.

**`listMessages` still takes only a session id.** Ownership is checked by the two routes that read a
transcript rather than inside the store, which is a seam the next phase could close by moving the
check into the port.

## Where the build deviated from the plan

Three places, all recorded in `docs/phase-6-design.md`: a tokenless request is the local user rather
than a `401` under the local default, the Clerk adapter's URLs are built but no JWKS verifier is
written (no Clerk instance exists on this machine), and no `/logout` command ships in this phase.

## Verification

`tools/verify-commits.sh` green on all five commits: typecheck, Biome, `bun test packages`, and a
real-terminal boot per commit. `bun test packages` is 280 pass, 0 fail.

One real-terminal drive of `nightcode login --url` in a pseudo-terminal, with a real `Bun.serve`
server on port 0 and the browser leg driven by `curl` from outside the pty. The CLI printed the
authorize URL, the loopback answered the callback with `200`, the token was written to
`~/.nightcode/auth.json` at mode `600`, and the app exited `code=0`.

Four mutations each break a named test: dropping the `system` field, making `listSessions` ignore the
caller, removing the ownership check from the routes, and making the middleware name no caller.

Two defects the process caught that a unit test would have missed. The loopback server closed the
connection before the browser's page finished writing, which `Bun.serve`'s synchronous
`server.stop(true)` in the request handler causes; the fix is an explicit `stop` in a `finally`. The
`Authorization` header merge dropped the request body, because a `Headers` instance has no
enumerable own properties and spreading one into an object literal writes nothing.

## Open risks

- A deployed server with no `NIGHTCODE_AUTH_SECRET` accepts forged tokens. Phase 9 refuses to boot in
  that state.
- The Clerk adapter is selected and its URLs are built, but no JWKS verifier exists. The 401 path is
  proved by a provider that refuses, not by a live Clerk login.
- The authorize code lives in process memory, so a server restart invalidates a login halfway
  through the browser round trip.
- No `/logout`. The token is deleted by removing `~/.nightcode/auth.json`.
- `noodle/`, an untracked directory the operator created in this checkout during the phase, moved
  the answer to "which file is third" in the mention picker. The tests now read the highlighted row
  off the screen instead of assuming, so the scan's contents no longer decide whether they pass.
