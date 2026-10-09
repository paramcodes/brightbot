# Phase 4 design: the streaming chat path

Phase 4 of `tools/plan.json` (issue #19). This file records the structural decisions the phase takes
and where they deviate from the plan. The arena that produced them is in
`.worktrees/phase-4-arena/`, which is throwaway once the phase ships. Three candidate designs ran
against the same grounding; the synthesis below names the base and the grafts.

## Problem

A model's output arrives over seconds, so the terminal has to render a stream, and the user has to be
able to stop that stream without killing the process. Four planned commits (4.1 endpoint, 4.2
rendering, 4.3 optimistic transition, 4.4 abort) are one flow, and the shipped code puts each piece in
the wrong place for it. `turns` lives in `RootLayout.tsx:32`, one level above the `SessionView` that
renders it, and the assistant block at `SessionView.tsx:38-41` is a hardcoded literal. `Escape`
reaches `onUnhandled` (`RootLayout.tsx:37`) and pushes a placeholder toast. `Message` has no status
while commit 4.4 requires one, so a shared type, two store implementations, the `StoreDocument` shape,
and the Prisma schema all move together. The file store's read-modify-write has no lock, which is the
first thing chat hits, because a turn is written on stream finish while other requests are in flight.

Constraints the design honors, all traced in the shipped code. The responder chain sees control keys
only, and printable characters are dropped before the chain (`keys.ts:23`), so an abort key cannot be
typed. Every external dependency sits behind a port with a local default, so the provider boundary
picks a deterministic scripted model when no key is present. No code path may require a secret to
start. Hono's `onError` hook never runs once `streamSSE`'s callback has started writing, so the route
reports its own failures. Relative imports carry `.js` extensions.

## Shape

### The wire

`packages/shared/src/schemas/chat.ts` holds one discriminated union on `type`, four variants, and
nothing else on the wire:

| frame | fields | when |
| --- | --- | --- |
| `text` | `text` | per text delta |
| `reasoning` | `text` | per reasoning delta |
| `finish` | none | once, when the generation ended without a provider failure |
| `error` | `code`, `message` | once, on a provider failure |

One SSE event name (`CHAT_STREAM_EVENT`), with the discriminant inside the JSON payload. Named
`event:` lines would be a second taxonomy parallel to `type`, and the two would have to stay in sync.
A closed union makes the client's decode exhaustive in one `switch`, so a fifth variant is a compile
error rather than a frame the CLI silently drops.

`chatRequestSchema` is `{ sessionId, messages }`, where `messages` is the whole transcript and the
schema refines that the last entry is a user message. The transcript travels with the request, so the
server stays stateless about the conversation and needs no `listMessages` on the store. The model is
read off the session row (`session.model`), so there is no second copy of which model answered.

### The provider boundary

`packages/server/src/lib/ai.ts` is a port of two event variants:

```ts
interface Model {
  readonly name: string
  stream(request: ModelRequest): AsyncIterable<ModelEvent>
}
type ModelEvent = { type: "reasoning"; text: string } | { type: "text"; text: string }
```

It is not the AI SDK's `LanguageModel`. That interface is wide, and every future capability (Phase 8
tools, Phase 7 usage) would have to be implemented in the fake before it works. `resolveModelKind` is
a pure read of the environment mirroring `resolveStoreKind`, so the choice is testable without a
network call, and `NIGHTCODE_MODEL_PROVIDER` overrides the key check so a test on a machine with
`ANTHROPIC_API_KEY` exported stays hermetic. The scripted model in `lib/providers/scripted.ts` is the
local default, tuned by `NIGHTCODE_SCRIPTED_REPLY` and `NIGHTCODE_SCRIPTED_DELAY_MS`, and it checks
`signal.aborted` before every yield so an abort lands between words.

The SDK adapters (`lib/providers/anthropic.ts`, `lib/providers/openai.ts`) import the SDK statically
inside their own module and are constructed only when their key is present. A static import resolves
against `packages/server/node_modules`, which is what the phase's `bun.lock` installs and what
`tools/verify-commits.sh` symlinks into every commit's worktree.

`toFrame` maps `ModelEvent` to `ChatFrame` through an exhaustive `switch` with a `never` branch, so
adding a variant to one union without the other fails the typecheck.

### The route

`POST /api/chat` (`packages/server/src/routes/chat.ts`) is the only writer of message rows. It
validates at the boundary with `zValidator`, looks up the session, persists the user turn before the
stream opens, and streams the assistant turn. `relayTurn` is exported and pure over an event iterable,
a `write` function, and the signal, so the complete / interrupted / failed decision is testable
without a socket.

The user row is written before the first token, so an abort that lands before any text still leaves
the ask on the record. The assistant row is written after the relay returns and before the `finish`
frame. That order is the whole of 4.4's server half, because the write is not gated on a socket that
is already gone. The status is derived from one `AbortSignal` evaluated at the last possible moment,
checked before each pull and after the loop, so it is never a value the CLI reports.

### The abort

The abort is a dropped connection, not a request. `controller.abort()` kills the fetch, the request
signal fires server-side, the loop breaks, and the `finally` writes what it buffered with
`status: "interrupted"`. One writer, one write, no second call that can fail after the first
succeeded. A rejected `writeSSE` is the other way a client leaves, and it converges on the same
controller, so both paths produce one status.

`Escape` stays on `RootLayout`'s `onUnhandled` fallback rather than a new responder layer. The
fallback runs only when every layer returns `false`, which is the precedence the feature wants. The
command palette's layer consumes `Escape` first and closes the menu, and the interrupt runs only when
nothing else claimed the key. A layer would sit above the palette whenever it registers later, so the
precedence would depend on registration order instead of on the chain's own rule. The existing test
"escape reports that there is nothing to interrupt" keeps passing, and a second assertion proves the
abort wins when a generation is live.

### The store

`Store` grows one method, `appendMessage(input: NewMessage)`, and `Message` grows one field,
`status`. `MessageStatus` is `["complete", "interrupted"]` and has no `"streaming"`, because a row is
written once, when the turn is over, so an unfinished row is unrepresentable. `FileStore`'s
`messageSchema` defaults `status` to `"complete"`. That default is the migration, because a store
written before this phase still parses. `PrismaDatabase` gains `message.create` and the schema gains
`status String @default("complete")`.

The file store serializes its writes through one promise chain behind `createSession` and
`appendMessage`. Without it, two overlapping turns read the same snapshot and the second `renameSync`
clobbers the first. Cross-process races over one `NIGHTCODE_HOME` remain as racy as they were, which
is Phase 3's existing behaviour and out of this phase's scope.

### The CLI

`packages/cli/src/lib/api-client.ts` grows `streamChat(request, signal)`, the one HTTP boundary the
CLI adds. It posts through the existing typed client, which types the URL and the payload at compile
time, and returns an `AsyncIterable<ChatFrame>` from a generator that splits the SSE body and
validates each frame with `chatFrameSchema`. A frame that does not parse ends the stream as a failure,
because an unparseable frame means the two sides disagree and silence would hide it. `ChatRequestError`
carries the server's own `ApiErrorBody` so a client mistake and a server bug are distinguishable.

`useChatStream` owns the `AbortController` and the `active` flag, and nothing else. `useChatSession`
owns the turns and the session id, and is the only writer of both. `send` appends the stub turn
synchronously, before the first `await`, and the controller is created in the same tick, so `Escape`
works from the moment `Enter` lands, including while the session is still being created. Text
accumulates through functional state updaters, so two deltas in one React batch cannot overwrite each
other.

`RootLayout` keeps owning the composer, the palette, the route, and the keyboard, and delegates the
conversation to the hooks. `SessionView` stays a pure renderer that takes literals as props, which is
what keeps `SessionView.test.tsx` a render test with no transport in sight.

### Rendering

`BotMessage` feeds accumulated content into OpenTUI's `<markdown>` renderable with its `streaming`
prop set while the turn is live, so the trailing block stays unstable until the generation finalizes.
That is the "markdown support" commit 4.2 asks for, already written and tested, instead of a parser
this repo would own. `UserMessage` renders the prompt as plain text rather than through the markdown
renderable, because a leading `>` would become a blockquote. Both need a `SyntaxStyle`, so
`chat/markdown-style.ts` maps a `Theme` to tree-sitter scopes in one place.

The message list lives in a `<scrollbox stickyScroll stickyStart="bottom" focused={false}>` in
`SessionView`. `focused` stays `false` on purpose, because a focused scroll box would put itself on
the responder stack and eat arrows from the composer.

`ThinkingBlock` is expanded while a turn is live and collapsed after. There is no keybinding for it,
because every printable key belongs to the composer and the control keys that remain are taken or
wrong for this.

## What this design deliberately does not do

- No `listMessages` on `Store`. Nothing in Phase 4 reads messages back, and Phase 5's session resume
  is the caller that earns it.
- No persisted reasoning text. The shared `Message` has no field for it, and Phase 5 decides whether
  "resume" means bringing the thought process back.
- No server spawned by the CLI. `bun run dev` still starts only the client.
- No token usage on the wire. The AI SDK's usage is dropped in the adapter with a comment naming
  Phase 7, which is the phase that meters it.
- No queue for prompts submitted while a generation is live. The send is refused with a toast, which is
  what makes one in-flight generation per session a real invariant.

## Verification

Each commit is proved by `tools/verify-commits.sh` in its own worktree, and the phase adds a
full-stack TUI test in `packages/cli/test/chat.test.tsx` that boots the real server in process with no
key and drives the real `App`, so the abort is proved against the artifact a user runs rather than
against an injected transport. The streaming tests need `untilSettled(predicate)` in
`packages/cli/test/harness.tsx`, because `settle()`'s `waitForVisualIdle` can idle out mid-stream.
