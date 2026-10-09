# Phase 4 report: Real-Time AI Chat Engine & Interruption Flow

Status: complete. All acceptance criteria hold.

- Branch: `phase-4-chat`
- Head: `94731b6` (`docs: name the escape precedence rule the shipped tests enforce`)
- Base: `033ee21` (`origin/master`, the feature-map fix)
- PR: [#53](https://github.com/paramcodes/brightbot/pull/53), CI green
- Six commits, one per plan item plus two docs commits, each green in isolation through `tools/verify-commits.sh`

## Commits

| SHA | Subject |
| --- | --- |
| `1865c63` | `feat(server): stream chat turns over SSE with a scripted default provider (#20)` |
| `bcd17dd` | `feat(cli): render chat messages with markdown and thinking blocks (#21)` |
| `918180c` | `feat(cli): submit a turn optimistically and stream the reply (#22)` |
| `178e307` | `feat(cli): interrupt a turn with esc and persist the partial reply (#23)` |
| `94731b6` | `docs: name the escape precedence rule the shipped tests enforce` |

## What was built

**4.1 The endpoint.** `POST /api/chat` streams over SSE through Hono's `streamSSE` and the AI SDK's `streamText`. The provider boundary is a port of two event variants rather than the SDK's own `LanguageModel`, so Anthropic and OpenAI answer when a key is present and a deterministic scripted model answers otherwise. That is what makes the streaming path provable with no credential: `resolveModelKind` is a pure read of the environment and the scripted model needs no import beyond its own file. `relayTurn` is exported so the complete / interrupted / failed decision is testable without a socket.

The wire is one SSE event name with the discriminant inside the JSON payload. Four frames in one closed union that both sides import, so a fifth variant fails the typecheck in every consumer at once rather than becoming a frame the CLI silently drops. `Message` gained `status` with exactly two values and no `"streaming"`, because a row is written once when the turn is over, so an unfinished row is unrepresentable. The file store serializes its writes behind one promise chain: without it two overlapping turns read the same snapshot and the second `renameSync` clobbers the first.

**4.2 Rendering.** The assistant body goes through OpenTUI's `<markdown>` renderable with `streaming` set while the turn is live, so the trailing block stays unstable and a half-written fenced code block does not flash as garbage. An empirical finding shaped this: inside the headless harness a finalized `<markdown>` renders blank for roughly 300 ms, so `packages/cli/test/harness.tsx` grew `untilSettled(predicate)` to wait on the renderable rather than on React. Verified against the real terminal through `tools/cli-pty.py`, where the finalized body renders correctly.

**4.3 The optimistic transition.** A submit puts the prompt and an empty assistant turn on screen in one state write before anything is awaited, so the frame the user sees next already holds the turn. `transcript` leaves out the message still being written, because the request schema refines on the last entry being a user message and an unfinished answer is not context. `useChatStream` creates its `AbortController` synchronously rather than after the session id arrives, so `Escape` has something to abort in that window.

**4.4 Interruption.** The abort is a dropped connection. `controller.abort()` kills the fetch, the request signal fires server-side, the loop breaks, and the route's `finally` writes the partial row with `status: "interrupted"`. No second route, no query parameter, no client-to-server echo of the partial text. Three tests carry it: a hook case, a precedence case, and a full-stack case that boots the real server and checks the screen, the interrupted row as a prefix of the reply, and the complete user row.

## Decisions a reviewer should push on

**Escape is a fallback, not a responder layer.** A layer registered while a turn streams sits above the command palette's layer whenever it registers later, so Escape would kill the generation instead of closing the palette. The fallback runs only after every layer returns `false`, which makes the precedence structural rather than dependent on registration order. Tested in three directions including the palette-open case, where Escape closes the menu and the generation keeps running.

**The client resolves its host per request.** `hc<AppType>` froze its base at module evaluation and a module registry is process-wide, so a test booting its own server could not point the shared module at it. The client now takes `""` as its path prefix and rewrites the host in a custom `fetch`.

**The header's status cell is never asserted in a test.** It drops or truncates that cell when the working directory is long, and a worktree path is far longer than the checkout path, so those assertions were cwd-dependent and hung in the isolated worktrees. The shell tests wait on the spinner's label in the body instead, and the status logic is covered as a pure unit test. The header truncation behaviour itself was already tested directly.

**`createChatRoute` must not name its return type `Hono`.** That annotation widens the route's schema to `BlankSchema`, which erases `/api/chat` from `hc<AppType>` and leaves the CLI with a typed client that cannot see the one route the whole streaming path depends on.

**The dependency bump was folded into 4.1.** A standalone dependency commit can never be typecheck-green under this repo's `verify-commits.sh`, because the script borrows the live `node_modules`, whose `@nightcode/shared` symlink already carries `Message.status`, while the dependency commit's `file-store.ts` predates it.

## Where the plan and the build differ

The plan named `useChatSession` as the file holding the CLI's conversation state. The View model moved to `packages/cli/src/core/chat/types.ts` because the commit-4.2 components are its first consumer and a hook that lands two commits later should not own a type six files import. The plan's file list also did not name `Spinner.tsx`, `markdown-style.ts`, `core/frame-clock.d.ts`, `core/chat/transport.ts`, or the harness helper, all of which the shipped shape needed.

## Verification

`tools/verify-commits.sh` green on all six commits: typecheck, biome, `bun test packages`, and a real-terminal PTY boot per commit. `bun test packages` is 143 pass, 0 fail. The full-stack tests in `packages/cli/test/chat.test.tsx` boot the real server in process with no key and drive the real `App` through `renderTui`. The interrupt path was mutation-proved: removing `chat.abort()` from `RootLayout` fails exactly the full-stack abort test, and mutating `useRootKeys` to claim `escape` before `dispatch` fails three tests including the precedence case.

Three driveability notes for whoever writes the next feature files. `tools/cli-pty.py` treats each `--script` delay as an interval after the previous entry, not an offset from the start, so the first entry fires at t≈0. A non-streaming `<markdown>` needs roughly 300 ms before its text is capturable in the `untilSettled` harness. And an abort that lands before any text arrives persists no assistant row, which is the committed behaviour rather than a gap: there is nothing to persist.
