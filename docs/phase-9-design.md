# Phase 9 design: shipping the thing

Phase 9 of `tools/plan.json` (issue #45). This file records the structural decisions the phase takes
and where they deviate from the plan. Every decision below rests on a measurement taken on this
machine before any code was written, because the plan was written against an assumption about what
OpenTUI does and half of it turned out to be already true.

## Problem

Night Code works and cannot be installed. There is no `bin` entry, so `nightcode` is not a command.
There is no container, so the server cannot be deployed. There is no review config, so nothing but
CI looks at a change. And a crashed CLI leaves the user staring at a dead terminal.

## What the measurements said

Four probes, run against the real binary in a real pseudo-terminal, before the first line of code.

**OpenTUI already owns terminal teardown.** Its `exitHandler` is registered for `SIGINT SIGTERM
SIGQUIT SIGABRT SIGHUP SIGPIPE SIGBREAK SIGBUS`, and `destroy()` restores the alternate screen, cursor
visibility, every mouse tracking mode, bracketed paste, and raw mode. It also traps
`uncaughtException` and `unhandledRejection`.

**Signals already exit cleanly.** A healthy app, sent `SIGTERM`, restores the terminal and exits
`code=0`. The same is true mid-stream: a turn streaming under the scripted provider with a 900 ms
delay, sent `SIGTERM` four seconds in, also exits `code=0`. A pending fetch does not hold the loop
open.

**An error does not exit at all.** An uncaught exception is printed into the TUI's own console panel,
the terminal stays in the alternate screen, and the process runs until a signal arrives. I had to
`SIGKILL` it. That is the one real gap.

**A non-TTY stdin hangs.** With stdout as a pty and stdin from `/dev/null`, the app renders the
banner and then sits there forever, because it can never read a key. The existing guard checks only
stdout.

## Shape

### 9.1: the launcher, and a guard that checks both streams

`bin/nightcode.js` is the entry point, with `#!/usr/bin/env bun` and a single import of the existing
`src/index.tsx`. There is no build step in this repo, so there is nothing to compile and the launcher
is a shim rather than a wrapper.

`assertInteractiveTerminal` now requires both streams. One message, one exit code, because a caller
who got it wrong needs one thing to fix rather than a guess about which half of the terminal failed.
The message and the code are unchanged, so the CI non-tty smoke test still passes on the same
grep.

**Deviation.** The plan said "validates terminal raw-mode TTY capabilities". That was half built:
stdout was checked and stdin was not, which is exactly the case that hangs.

### 9.4: traps for the error paths, and nothing else

`lib/terminal-cleanup.ts` holds two handlers, for `uncaughtException` and `unhandledRejection`. Each
one writes the reason to stderr, tears the renderer down through the renderer's own `destroy()`, and
exits non-zero.

**Deviation.** The plan named `SIGINT`, `SIGTERM`, and `uncaughtException`. Signals are already
handled correctly, measured twice. A second handler for them would be a second writer of teardown
state, and two writers of terminal state is a bug rather than a belt. They are not added.

The teardown delegates to the renderer rather than writing escape sequences. The phase's own plan
listed "restore standard cursor visibility, disable mouse tracking, reset raw mode, and clear
alternate screen buffers" as four separate jobs, and OpenTUI's `destroy()` already does all four.
Re-implementing them would be four chances to disagree with the library about what the terminal
should look like.

The handler writes to stderr and never to stdout, because CI asserts stdout is byte-empty on the
non-tty path, and that path exits before a renderer exists. The handler therefore tolerates there
being no renderer.

An error is not swallowed. The stack goes to stderr before the teardown, because the alternative is
printing a stack trace into a terminal that is about to be restored, where nobody can read it.

### 9.2: a container that boots with no secret

The Dockerfile installs the workspace, runs `bun run --cwd packages/server src/index.tsx`, and
exposes 3000. No `DATABASE_URL` is required, because `resolveStoreKind` falls back to the file store
and the file store writes under `NIGHTCODE_HOME`. `prisma generate` runs offline in the postinstall,
so the image builds in a cold clone.

### 9.3: a review config

`.coderabbit.yaml` carries the three rules this repo already enforces by hand: the responder chain
sees control keys only, every dependency sits behind a port with a local default, and external input
is validated at the boundary.

## What this phase deliberately does not do

- No `SIGINT` or `SIGTERM` trap. See above.
- No hand-written terminal escape sequences. `destroy()` owns them.
- A recorded demo is not one of the four commits. It is recorded separately once the phase is green.
- No compiled artifact. There is no build step and adding one for a launcher would be a build that
  produces the file it was given.

## What this phase left behind

- The traps are registered in `index.tsx` at module scope, so a test that imports `index.tsx` gets
  them. Nothing in the suite does today, and the two probes were run as temporary files rather than
  as tests, because a test that crashes the process on purpose is a test that cannot report.
- A renderer created and never adopted would leave the traps with nothing to tear down. The
  registration is one line beside the `createRoot` call, and that adjacency is the only thing keeping
  them honest.

## Verification

### Verify, unit

Per-commit isolation by `BASE_REF=origin/master bash tools/verify-commits.sh`. The new suites are
`core/renderer.test.ts` for the both-streams guard and `lib/terminal-cleanup.test.ts` for the
teardown with and without a renderer. CI's non-tty smoke test still passes on the same exit code and
the same stderr string.

### Verify, live

`bun link` the package from the worktree, then run `nightcode` from a different directory and confirm
it boots. Send it `SIGTERM` and confirm `code=0` with the screen restored. Throw past the trap and
confirm the process exits non-zero rather than parking a dead TUI.

### Verify, perf

There is no hot path. The launcher is one import and the guard is two boolean reads in front of a
renderer that already costs milliseconds, so no perf gate is claimed. The measurement that matters
here is that `bun link` plus a cold start lands the first frame at the same place the unbundled
`bun run dev` does.
