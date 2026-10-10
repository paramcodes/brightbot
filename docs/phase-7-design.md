# Phase 7 design: credit metering, gating, and the top-up loop

Phase 7 of `tools/plan.json` (issue #34). This file records the structural decisions and where they
deviate from the plan.

## Problem

The server spends real money on every turn and has no way to count it. `TokenUsage` was declared in
`packages/shared/src/ports/store.ts`, mirrored in the file store's document schema, mirrored again in
the Prisma schema, and read and written by no code at all. Both provider adapters dropped the `finish`
part of the AI SDK stream, which is the part that carries the token counts, and the comments at
`lib/providers/anthropic.ts` and `lib/providers/openai.ts` named that gap. A turn that costs money and
a turn that costs nothing looked identical from the outside.

Three things had to become true at once. A credit balance has to exist and be readable before a turn
starts. A turn with no credits has to be refused before a single token is spent. The user has to be able
to see the balance and add to it without leaving the terminal.

## Shape

### One port in shared, two ledgers that meet on a balance

`shared/src/ports/credits.ts` holds the `CreditLedger` interface and every record it moves, and it is
the only file both sides import. The interface has four methods, and the shapes are derived from the
environment the same way `resolveStoreKind` and `resolveModelKind` are, so the choice is a pure
function and a test needs no credentials.

```ts
export function resolveCreditProviderKind(environment): CreditProviderKind {
  return environment.POLAR_ACCESS_TOKEN ? "polar" : "local"
}
```

The port lives in shared rather than in the server because `CreditEntry` is the row the `/usage` dialog
renders. A field added to the entry is a compile error in the dialog rather than an empty column a user
stares at.

The interface is in shared rather than beside `AuthProvider` in the server because `Store`, the other
persistence port, is in shared. A port in shared is a contract a reviewer can read without opening the
server.

`services/credits.ts` holds the local ledger, which is JSON on disk under `NIGHTCODE_HOME`, and
`lib/polar.ts` holds the adapter, which is `fetch` against the Polar REST API. `createCreditLedger()`
memoizes one ledger per process the way `createStore()` does, keyed on kind.

### A credit is a cent of model spend

`USD_PER_CREDIT` is `0.01`. `creditsFor(model, usage)` in shared turns the pair of token counts into
credits using the published per-million rates in `shared/src/constants/models.ts`, which is the only
cost data in the repo. A model outside that table is metered at the most expensive row in it, because
an unknown price is a price you must not under-report.

A turn's credits are rounded to a whole number. The reason is that a credit is the unit a user is
charged in, and a balance that carries a fraction of one is a balance nobody can read. The consequence
is that a turn smaller than the granularity is free, which is recorded below rather than hidden.

The conversion lives in shared and not in the ledger because the number is a fact about a model
rather than about a user, and a pure function over a literal is assertable in the shared suite without
a server.

### The ledger owns its own document

`LocalCreditLedger` reads and rewrites `credits.json` under `NIGHTCODE_HOME`, with the same
`serialize` chain the file store uses so two overlapping deductions cannot clobber each other.

The ledger is not a table on `Store`. Widening `Store` would mean a new method, a new row shape, a new
array in `StoreDocument`, a new entry in `documentSchema`, a new model in `schema.prisma`, and a new
delegate on the hand-maintained `PrismaDatabase`, all for a port whose remote implementation has no
rows at all. A separate file is also the safer shape: the store document and the ledger document have
independent serialized write chains, so a deduction and a session write race nothing.

`TokenUsage` dies in this phase instead of becoming the entry. `CreditEntry` is `TokenUsage` with a
caller and an amount, so keeping both would leave two shapes that differ by whether anyone ever reads
them.

### The gate answers 402 before a token is spent

`middleware/credits.ts` resolves the ledger, puts it on the context the way `requireAuth` puts the
caller there, and throws `ApiError(402, ...)` when the caller's balance is exhausted. The middleware
is mounted inside `createChatRoute` so the gate travels with the route and a test that mounts the route
gets the refusal it is supposed to prove.

The gate runs before `streamSSE` at `routes/chat.ts`. A 402 raised after the stream opens would arrive
as a chat frame inside a `200`, and the client would render it as an answer.

`STATUS_CODE` in `middleware/error-handler.ts` gains `402: "PAYMENT_REQUIRED"`, so a client can branch
on the code rather than on the sentence. The CLI does not branch today. The message it renders already
names the command that fixes it.

The `/api/credits` routes are deliberately not gated. A caller at zero credits has to be able to read
the balance and top up, or the hard stop becomes a lockout.

### Usage leaves a provider as the generator's return value

`Model.stream` returns `AsyncGenerator<ModelEvent, TokenUsage | undefined>`. An async generator's
return value is the one thing a consumer learns when the stream ends, which is exactly when a provider
knows what it billed. `relayTurn` already held the iterator by hand, so `next.done` hands it the usage
without a single byte crossing the wire.

This is why `chatFrameSchema` does not change. The wire stays a closed union of what a user reads, and
a token count that no user reads does not become a frame the client has to handle.

The adapters return the `finish` part's usage. The scripted provider, which is the local default,
estimates it, and the function that does it is named for what it is. An interrupted turn never reaches
a `finish` part, so it carries no usage and is not metered. That is a recorded debt rather than a
silent generosity.

`services/token-tracker.ts` is the bridge from a finished turn to a charge. It reads the model's rate,
computes the credits, and calls `ledger.record`. It never throws into the turn: a live answer that
already happened is not made untrue by a ledger that failed to write, so a failure is reported and the
turn still finishes.

### The top-up is a discriminated union

`TopUpResult` is either a grant that already happened or a URL the user has to visit.

```ts
export type TopUpResult = { readonly kind: "granted"; readonly credits: number } | { readonly kind: "checkout"; readonly url: string }
```

The local ledger grants a development pack and the CLI reports the new balance. The Polar ledger
creates a checkout session and the CLI opens the URL, which is the same one-line branch either way:
open it if there is a URL, otherwise report the grant. Neither side knows the other's pack size.

`POLAR_ACCESS_TOKEN` selects the adapter, `POLAR_CHECKOUT_PRODUCT_ID` names the product, and
`POLAR_SERVER` picks production or sandbox. The Polar calls are `POST /v1/events/ingest` for a
charge, `GET /v1/customer-meters/` for a balance, and `POST /v1/checkouts/` for a top-up. The
request and response shapes come from Polar's own OpenAPI schema for API version `2026-10`, read on
2026-10-10. No SDK is installed. `@polar-sh/sdk` would be a dependency that never runs on this
machine, and the adapter is three calls over `fetch`.

## What this phase deliberately does not do

- No rate limiting. The phase title names it and none of the four commits do, so it is left for a
  phase that names a limit.
- No Clerk JWKS verifier. `docs/phase-6-design.md` hands it to this phase, but no Clerk instance
  exists on this machine and the credit meter does not need one: the caller is already an `AuthUser`
  with an id by the time a balance is read. An unprovable verifier is worse than a recorded debt.
- No expiry and no refresh on credits. A balance is spent, not consumed by a clock.
- No header cell for the balance. It would need a poll, and the plan asks for a dialog.
- No token counts on the chat wire. The frame union stays closed.
- No Prisma ledger model and no migration. There is no migration tooling in this repo, so a model
  would be codegen with no table behind it. The local ledger is what actually runs.
- No `session.update`. `updatedAt` stays write-once, so ownership of a row never moves.

## What this phase left behind

- A turn that is interrupted is not metered. The provider billed for the tokens that streamed before
  the abort, and the `finish` part never arrives, so the charge is lost. Metering it needs the
  adapter to hold the usage across an abort.
- The balance is checked as a single number, so a caller with two credits left can start a turn the
  turn cannot pay for. A pre-flight estimate needs a token ceiling per request, which the request
  body does not carry.
- The local ledger keeps every entry forever in one JSON file. A year of turns is a year of rows in
  one document, read in full on every balance check.
- `nightcode login` writes a token and `nightcode logout` still does not exist, so a signed-in user
  removes `~/.nightcode/auth.json` by hand.
- No live Polar call has been made. The adapter is proved against an injected `fetch` that pins the
  URL, the bearer header, and the body, which is the same standard `middleware/auth.ts` is held to.
- The credit grant of 500 is a development default with no warning attached, exactly like
  `DEVELOPMENT_SECRET` in `auth/local.ts`. A deployed server running the local ledger hands every
  caller free money.
- `credits.json` next to `store.json` means `NIGHTCODE_HOME` holds two independently serialized
  documents. That is deliberate and it is the thing to watch if a third appears.

## Verification

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf
boxes are all checked.

### Verify, unit

Every commit is proved in its own worktree by `BASE_REF=origin/master bash tools/verify-commits.sh`,
which runs typecheck, Biome, the suite, and a real-terminal boot per commit. The new suites are
`ports/credits.test.ts` for the rate and the union, `services/credits.test.ts` for the ledger's
document and its serialized chain, `lib/polar.test.ts` for the three calls against an injected
`fetch`, `routes/credits.test.ts` for the two ungated routes, and a `routes/chat.test.ts` case for the
402 that follows the existing failure-case template.

### Verify, live

A booted server on port 3000 was driven over real HTTP with `NIGHTCODE_HOME` pointed at a scratch
directory. The balance read 500 before any turn, a turn streamed its frames and charged the credits
its model's rate implied, the balance dropped by that amount, a second server with a zeroed ledger
refused the next turn with `402` and the `PAYMENT_REQUIRED` code while the balance stayed readable,
and `POST top-up` granted 500 and moved the balance.

The real-terminal drive runs `nightcode` through `tools/cli-pty.py` with `NIGHTCODE_HOME` pointed at
the run directory, opens `/usage`, reads the rendered balance out of the captured bytes, and opens
`/upgrade` to see the pack row. The app exits `code=0`.

### Verify, perf

The gate adds one read of a small JSON file in front of a turn. The metric is time to first streamed
frame under the scripted provider with its delay at zero, measured at trunk and at the head,
interleaved, with the trunk baseline recorded first. The trunk median was 24 ms and the head median
24 ms over 15 samples each, a delta of 0 ms, with the head's maximum at 32 ms against the trunk's
30 ms. The budget was that the head is no slower than the trunk by more than 5 ms.
