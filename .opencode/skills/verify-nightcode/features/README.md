# Night Code verification map

This directory is the maintained source for verifying the user-facing behavior of the Night Code CLI. Read
this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `bun install` has run in the repo root.
- The build under test is recorded with `git -C . rev-parse --short HEAD`.
- The launch command is `bun run --cwd packages/cli src/index.tsx`, driven only through
  `tools/cli-pty.py`.
- Every drive runs in its own PTY. Two drives never share a terminal.
- `NIGHTCODE_HOME` points at a directory under the run folder once the app writes preferences, so a run
  never touches the real home directory.
- Kills are by driver only. Never kill a process by name.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted strings and escapes unchanged.
- Record the app exit line from every PTY drive. `code=0` is a clean exit, `signaled signo=2` is a defect.
- Capture the action and the resulting state. A final screenshot alone is not a proof.
- A passing unit test is not live-surface proof. If the real PTY cannot reach a path, report the unmet
  precondition instead.
- Proof artifacts live in `/tmp/nightcode-verify/$RUN/` and survive cleanup. Each run writes a `STATUS`
  file with `pass` or `fail`.

## Proof standards

- UI proof includes the raw terminal transcript plus a rendered screenshot with the app identity visible.
- CLI proof includes the command, the bytes the app wrote, and the exit status.
- Interrupt proof includes the exit status: the app exits on its own path, it is not killed by a signal.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a
  skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then
uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the PTY harness` starts with `Preconditions:` and uses labeled bullets that pair each
   user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Shell and composer](./shell-and-composer.md) covers the landing shell, the header, the banner, typing into the composer, and submitting.
- [Keyboard responder chain](./keyboard-responder.md) covers control-key routing, layer consumption, and the ctrl+c exit path.
- [Toast feedback](./toast-feedback.md) covers push, dismiss, and auto-dismiss.
- [Non-TTY guard](./non-tty-guard.md) covers the refusal to run without an interactive terminal.
