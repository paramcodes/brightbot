# Phase 8 design: the client-side tool engine

Phase 8 of `tools/plan.json` (issue #39). This file records the structural decisions the phase takes
and where they deviate from the plan.

## Problem

The agent can talk and it cannot act. `POST /api/chat` streams text and reasoning frames and nothing
else, so the model has no way to read the repository the developer is looking at. Two comments in
`lib/providers/anthropic.ts:22` and `lib/providers/openai.ts:22` already name the gap. They say tool
parts arrive and are out of this phase's scope.

Four things had to become true at once. The model has to be able to ask for a file. The CLI has to run
that ask on the machine the file lives on. The result has to reach the model as context for its next
answer. And a call that writes or deletes has to pass the user first.

The plan's shape puts tools on the server and the loop on the client. That is the whole point of the
phase, and it is the constraint every decision below honors: the server becomes a stateless proxy
that offers a tool set and relays one step, and the CLI keeps execution authority.

## Shape

### One tool contract in shared, one executor per tool in the CLI

`packages/shared/src/tools/schemas.ts` holds the seven contracts. Each is a zod schema for the
input, a one sentence description the model reads, and a name. `TOOL_NAMES` is the closed tuple, so
a name the client cannot run is not a name the schema accepts.

`packages/shared/src/tools/types.ts` holds the two records the loop moves. `ToolCall` is what the
model asked for, `ToolResult` is what the CLI got back, and both carry the `toolCallId` that pairs
them. The generator mints the id, because it is the only party that can guarantee it is unique.

The schemas live in shared rather than in the server because the server builds the tool definitions
the model sees and the CLI parses the input it receives. One declaration means the two cannot drift,
which is the same reason `Store` lives there.

### The mode chooses the tool set

`toolsForMode(mode)` is a pure function of `AgentMode`. Plan mode gets `read_file`,
`list_directory`, `glob`, and `grep`. Build mode gets those plus `write_file`, `edit_file`, and
`bash`.

Phase 5 promised a read-only discovery mode and wrote it into the system prompt. A tool engine that
ignored that promise would make the prompt a request rather than a rule, so the capability follows
the mode instead of the prompt. The client sends its tool set on every request and the server offers
exactly what arrived, which means a build-mode caller and a plan-mode caller are different requests
rather than the same request with different wording.

### The wire gains two things, and the store gains neither

`chatFrameSchema` gains a fifth variant.

| frame | fields | when |
| --- | --- | --- |
| `tool-call` | `toolCallId`, `toolName`, `input` | once per call the model asked for |

`chatMessageSchema` becomes a discriminated union on `role`. The `tool` variant carries `toolCallId`,
`toolName`, `input`, `output`, and `ok`, so one row holds both ends of a call. The existing three
variants are unchanged. The request's refine now accepts a transcript that ends on a user message or
a tool message, because a tool round ends on the result.

The request also gains `tools`, required. A caller that sends nothing offers nothing, and that has to
be a decision rather than an omission.

`ROLES` in `ports/store.ts` does not change. The store keeps three roles because a tool round is
execution, not conversation, and Phase 7 recorded why widening `Store` for a shape only one caller
moves is the wrong trade. The server writes the user row before the stream and the assistant row
after it, exactly as it does today. A tool round is not persisted.

### The model asks once per step and the CLI answers

`ModelRequest` gains `tools`. The SDK adapters pass them to `streamText`, which stops after one step
by its own default `stopWhen: stepCountIs(1)`. That default is the shape the client loop needs, so
nothing is configured to get it. A tool definition carries no `execute`, because the executor lives
on the developer's machine and the server has none.

`ModelEvent` gains a `tool-call` variant. `toFrame` gains the matching arm, and its exhaustive
switch is what forces the two to stay in step.

`relayTurn`'s accumulator is rewritten as an exhaustive switch. Today it reads
`if (event.type === "text") content += event.text; else reasoning += event.text`, which would
quietly append a tool-call event to the reasoning. That line is the one place in the server where a
new event variant would be silently swallowed rather than refused, and it is fixed here rather than
worked around.

`toModelMessages` maps the `tool` variant onto the SDK's `ToolModelMessage`, using `{ type: "text",
value }` for a result that succeeded and `{ type: "error-text", value }` for one that did not. That
is the SDK's own channel for a failed call, so a refusal the model caused is told to the model as a
failure rather than as a sentence it might read as an answer.

### The local default proves the loop with no credentials

`scriptedModel` gains two env knobs. `NIGHTCODE_SCRIPTED_TOOL_CALL` names a tool and
`NIGHTCODE_SCRIPTED_TOOL_INPUT` is the JSON input. When the transcript's last message is a user
message and the knob is set, the scripted model yields one tool-call event and no text. When the
last message is a tool message, it streams the reply.

That trigger is the real behavior, not a special case: a model that was just handed a result answers,
and one that was just asked a question calls. It makes the whole loop drivable in the real terminal
with no provider key, which standing order 5 requires.

### The loop, the cap, and the confirmation

The loop lives in `useChatSession`. It keeps the transcript the CLI has sent, drains frames, collects
tool calls, and when a step produced any it runs them, appends the calls and their results, and posts
again.

`MAX_TOOL_ROUNDS` is 8. Beyond eight rounds the model is stuck rather than working, and the user
should see that instead of paying for it. On reaching the cap the turn fails with a named message.

Confirmation gates `write_file`, `edit_file`, and `bash`. `ConfirmToolDialog` is a `DialogSearchList`
wrapper with three rows, so it inherits the modal's focus and key handling for free. Deny is a real
answer: the run records `denied` and the CLI feeds a refusal back to the model, so the model learns
it cannot proceed instead of waiting for a result that never comes. Always-allow is a set of tool
names scoped to the session.

The dialog registers a responder layer, which takes `escape` while it is open and releases it on
close. The abort lives on `onUnhandled` for the reason recorded at `RootLayout.tsx:135`, and that
precedence is exactly what a confirmation wants.

### Containment at the executor boundary

`lib/fs-utils.ts` holds `resolveWithin(root, target)`. Every path-taking tool resolves its argument
against the working directory and refuses anything that escapes it. The check is not user
overridable, because a confirmation is a decision about one command and not a decision about the
whole session's blast radius.

`bash` runs with the working directory as its cwd and is not contained, because a shell that cannot
name another directory is a shell that cannot run `git -C`. Its gate is the confirmation, and that
asymmetry is recorded rather than smoothed over.

`lib/tree-walk.ts` is extracted from `file-scanner.ts` so `glob` and `grep` walk the same tree the
`@` picker does. One walk with one set of skip directories means a tool cannot surface a file the
picker deliberately hides.

## What this phase deliberately does not do

- No `useAgentLoop.ts`. The plan names it, and the loop needs the abort controller, the generation
  counter, and the message patcher that `useChatSession` already owns. A second hook would carry all
  three across a boundary for no gain.
- No `@ai-sdk/react` `useChat`. The plan names it. The CLI already reads the SSE stream itself, and
  adopting the client hook would change the abort semantics, the message shapes, and the responder
  wiring at once.
- No persisted tool rows. See above. A resumed session replays the conversation and not the
  mechanism.
- No streaming of tool output. A command's output arrives when the command ends.
- No tool approval by the server. The confirmation is a client screen, because the executor is the
  client.
- No live provider call. The adapters gain the tool arm and the route is proved against an injected
  `Model`, which is the standard the existing route tests already hold them to.

## Regression lane against trunk

Every behaviour change the diff makes, and which of them are the feature.

| change | file | verdict |
| --- | --- | --- |
| a turn with no tool call produces the same frames in the same order | `relayTurn` | intended, no change |
| the credits gate now runs once per round of a multi-round turn | `routes/chat.ts` | intended. A caller cannot run a paid loop past a zero balance, and gating only the first round would let them |
| a tool round writes no user row, so the persisted transcript is shorter than the stream | `routes/chat.ts` | intended. The mechanism is not the conversation |
| `escape` during a confirmation denies it instead of interrupting the turn | `RootLayout.tsx` | intended. A prompt whose answer never arrives would hang the turn |
| the composer unfocuses while a confirmation is up | `RootLayout.tsx` | intended, same shape as every other modal |
| the request now requires `tools`, so a caller that sent neither is refused with a 400 | `schemas/chat.ts` | intended. A missing field was being read as "offer nothing" |
| `always` is forgotten on `/clear` and on resume | `useChatSession.ts` | defect found and fixed in this phase, not a change from trunk |
| a command that left a background process behind no longer hangs the turn | `local-tools.ts` | defect found and fixed in this phase |
| `grep` no longer returns one unbounded line | `local-tools.ts` | defect found and fixed in this phase |

A turn with no tool call is byte-identical to trunk on the wire, because `tools` is the only field the
route reads and an answer that calls nothing never emits a frame the union did not already carry.

## What this phase left behind

- The tool round is not persisted, so resuming a session mid-conversation loses the calls that got
  it there.
- An interrupted turn is still not metered. That debt was named in Phase 7 and this phase adds a form
  of it, because an aborted loop has already paid for the rounds it finished.
- The SDK adapters' tool arm is untested against a live provider. No key exists on this machine.
- `bash` is uncapped in blast radius beyond its timeout and the confirmation.
- A plan-mode caller can still be handed a bash command in its prompt and nothing stops the model
  describing one. The capability is withheld, not the vocabulary.

## Verification

### Verify, unit

Four commits on `phase-8-tools`, each proved in its own worktree by
`BASE_REF=origin/master bash tools/verify-commits.sh`. Every row is green on typecheck, Biome, the
suite, and a real-terminal boot.

| commit | title |
| --- | --- |
| `501e208` | the tool contracts and the tool round on the wire (#40) |
| `50aa2f6` | the seven executors against the working directory (#41) |
| `2748504` | the loop, the confirmation, and the grouped block (#42) |
| `3b7a68f` | a failed tool run is not a denied one (#43) |

The new suites are `packages/shared/src/tools/schemas.test.ts` for the contracts and the
mode-to-set function, `packages/cli/src/lib/local-tools.test.ts` for the seven executors, the
containment rules, and `matchGlob`, `packages/cli/src/components/chat/ToolCallBlock.test.tsx` for
the grouped block, and new cases in `packages/cli/src/hooks/useChatSession.test.tsx` for a
two-round loop, a denial, a tool that runs and fails, and the cap. The route suite gains a case
that a tool call reaches the wire and a case that the tool round writes no user row.

392 tests pass. The two Biome warnings that remain are the ones that were already on master.

### Verify, live

Driven through `tools/cli-pty.py` with a booted server on port 3000 and
`NIGHTCODE_HOME` pointed at a scratch directory. The scripted provider asked for `read_file` and
the reply followed the result. The captured stream holds the prompt, `1 tool call · failed`, the
`read_file · failed · 1ms` row, and `readme is there` as the answer, and the app exited `code=0`.

```
app exit code=0
expect-ok: found 'readme is there'
```

The run first exposed two real defects, both now fixed and both now covered. A call that ran and
failed was recorded as `denied`, which is the word for a user who pressed no, and the wire carried
its result with `ok: true`, so the model was told a failed read had succeeded.

### Verify, perf

The metric is wall-clock of one turn under the scripted provider with its delay at zero, measured
interleaved, trunk first. Trunk has no tool loop, so the trunk number is the same turn with no
tools offered and the two are not a ratio.

| side | what ran | median | min | max |
| --- | --- | --- | --- | --- |
| trunk | one request, no tools | 12.7 ms | 9.1 ms | 19.7 ms |
| head | one request, tools offered | 11.6 ms | 9.1 ms | 42.6 ms |
| head | a full two-round tool loop | 17.0 ms | 11.5 ms | 29.1 ms |

12 samples each. The budget was that the single request is no slower than the trunk equivalent by
more than 5 ms and that a two-round loop completes within 1500 ms. The single request is 1.1 ms
faster than trunk and the loop lands 4.3 ms over it, both inside the budget. The wide max on the
head's single request is a first-run artifact and is not the median.
