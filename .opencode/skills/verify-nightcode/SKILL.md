---
name: verify-nightcode
description: Drive the Night Code terminal CLI to prove user-visible behavior. Launches the real TUI in an isolated pseudo-terminal, sends keystrokes, and captures terminal transcripts, screenshots, and the app's own exit status. Use for any Night Code CLI change, before a PR, and when a TUI bug report needs reproduction.
---

# Verify Night Code

Verify Night Code by driving the artifact a user runs: the TUI in a real pseudo-terminal. A passing
unit test is not live-surface proof. Both surfaces are required for a full verdict.

## Surfaces

| Surface | What it is | State |
| --- | --- | --- |
| CLI / TUI | `nightcode` terminal interface | live from Phase 1 |
| HTTP API | Hono relay for chat, auth, credits | lands in Phase 3; verify with real HTTP when it exists |

## Launch

Build once, then start one isolated PTY per drive. There is no server to keep alive.

```
bun install                        # once per checkout
bun run dev                        # what the user runs; never launched directly by the skill
```

`tools/cli-pty.py` is the launcher. It forks the command into its own pseudo-terminal at a fixed size,
sends a keystroke timeline, captures every byte the app writes, and reaps the child so it can report how
the app ended.

```
python3 tools/cli-pty.py \
  --cmd "bun run --cwd packages/cli src/index.tsx" \
  --script "1.0:hello from the terminal;0.7:\r;1.2:\e" \
  --expect "Queued: hello from the terminal" \
  --raw /tmp/nightcode-verify/$RUN/run.raw
```

Keystroke escapes in `--script`: `\r` return, `\t` tab, `\e` escape, `\b` backspace, `\x1b[A` up,
`\x1b[B` down. Ready means the first frame containing the prompt placeholder `ask nightcode to do
something`, which the driver prints once `--expect` matches.

Teardown: the driver closes the pty and reaps the child, so no process survives a run. Do not leave a
drive running between checks.

## Doctor

Run this first whenever anything looks off. It is read-only.

```
git -C . rev-parse --short HEAD                    # the build under test
bun run typecheck                                  # exits 0
bunx biome check .                                 # exits 0; one deprecation info is expected
bun test packages                                  # 31 pass, 0 fail as of Phase 1
python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
  --script "0.8:hello;0.6:\r" --expect "Queued: hello"
```

The last line of every drive is `captured N chunks, M bytes, app exit <status>`. `code=0` means the app
left on its own path. `signaled signo=2` means the app died on SIGINT, which is a defect, not a pass.

## Drive

Two harnesses, and they are not interchangeable.

- **Real PTY** (`tools/cli-pty.py`). Required for anything a user sees or any exit behavior. Evidence is
  the raw byte stream, and `--expect` fails the run when the target text never appears.
- **Headless frames** (`bun test packages`). Required for state transitions that are hard to catch in a
  byte stream, such as a modal consuming a key before the shell. The harness lives at
  `packages/cli/test/harness.tsx` and renders the real component tree through `@opentui/react/test-utils`.

Rules that make both deterministic:

1. Every control key goes through the kitty-encoding helpers (`pressEscape`, `pressEnter`,
   `pressArrow`). `pressKeys` sends legacy bytes and the kitty parser drops a bare `escape`.
2. After a keypress, `settle()` yields a macro-task before `flush()`. React schedules the update, and
   `flush()` alone does not yield the event loop, so a frame captured immediately shows the previous
   render.

## Evidence

Write every artifact under `/tmp/nightcode-verify/$RUN/` where `$RUN` is the feature ID. Capture the
action and the resulting state, not only the final screen.

- **Transcript.** `--raw /tmp/nightcode-verify/$RUN/run.raw` for every PTY drive. Grep it for the text
  the user should see, and record the grep count in the report.
- **Screenshot.** Record a cast, render it, and read the image back.

  ```
  python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
    --script "1.0:hello from the terminal;0.7:\r;1.2:\e" \
    --cast /tmp/nightcode-verify/$RUN/run.cast
  agg --theme dracula --font-family "JetBrainsMono NF" --font-size 14 \
    /tmp/nightcode-verify/$RUN/run.cast /tmp/nightcode-verify/$RUN/run.gif
  convert '/tmp/nightcode-verify/$RUN/run.gif[1]' -resize 60% \
    /tmp/nightcode-verify/$RUN/shell.png
  ```

- **Exit status.** The driver's `app exit` line. For an interrupt proof, `code=0` is the pass and
  `signaled signo=2` is the failure.
- **Test frames.** `bun test packages` output, plus the frame text a test asserts on when a claim is
  about layout or key routing.

A passing unit test is not live-surface proof. If a feature cannot be reached in the real PTY, say so and
name the blocking precondition instead of substituting a test run.

## Cleanup

Kill nothing by name. The driver already reaped what it started. Remove scratch directories only:

```
rm -rf /tmp/nightcode-verify/$RUN/scratch
```

Never delete evidence. When the app later writes to `~/.nightcode`, set `NIGHTCODE_HOME` to a directory
under the run folder and delete only that directory. Record the outcome in `/tmp/nightcode-verify/$RUN/STATUS`
as `pass` or `fail`, so a failed attempt is never mistaken for proof.

## Helpers

| Helper | What it does |
| --- | --- |
| `tools/cli-pty.py` | Forks a command into an isolated PTY, sends a keystroke timeline, captures raw bytes and a cast, reaps the child, reports the app's exit status |
| `packages/cli/test/harness.tsx` | Renders the real component tree headlessly at a fixed size with kitty keys on, and exposes `press`, `type`, `settle`, `frame` |
| `tools/verify-commits.sh` | Runs typecheck, Biome, tests, and a PTY boot for every commit on the branch in its own worktree |

## Feature map

See `features/README.md` in this directory. Drive the feature file that matches the change; a proof that
drives one convenient entry point is incomplete when the map lists others.
