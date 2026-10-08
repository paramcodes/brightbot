# Non-TTY guard

Night Code needs an interactive terminal. Raw mode, cursor addressing, and alternate-screen buffers are
meaningless on a pipe, so the app refuses to start without a TTY instead of writing escape codes into a log
file or a CI log.

## Sub-features

- `guard-refuses` exits non-zero with a readable message on a non-TTY stdout.
- `guard-clean` writes nothing to stdout when it refuses.

## How to get to it (user POV)

- Run `nightcode | cat` or `nightcode > out.txt` in a shell: the app does not start.

## Driving it with the PTY harness

Preconditions:

- The guard is proven outside a PTY, because the whole point is that stdout is not a terminal.
- Capture stdout and stderr separately so the claim about which stream carries the message is checkable.

- **Prove the refusal.** Run
  `bun run --cwd packages/cli src/index.tsx < /dev/null > /tmp/nightcode-verify/guard/stdout.txt 2> /tmp/nightcode-verify/guard/stderr.txt; echo "exit=$?"`.
  The exit code is `1`.
- **Prove the message.** Run
  `cat /tmp/nightcode-verify/guard/stderr.txt`. It reads
  `nightcode needs an interactive terminal. Run it directly, not through a pipe.`
- **Prove stdout stayed clean.** Run
  `wc -c < /tmp/nightcode-verify/guard/stdout.txt`. It is `0`.

## Gotchas

- A PTY drive can never prove this feature: the child's stdout is a terminal. Run this check with a plain
  redirection, and never wrap it in `tools/cli-pty.py`.
- The guard exits before the renderer is created, so no cleanup or exit trap is required for this path. If
  the app later prints a partial frame before refusing, that is a regression.
