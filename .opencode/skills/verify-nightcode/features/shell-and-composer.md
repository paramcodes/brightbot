# Shell and composer

The shell is what a user sees the moment Night Code starts: a status header, the Night Code banner, the
composer where prompts are typed, and a hint row. Typing echoes into the composer, and return submits the
prompt into the session.

## Sub-features

- `shell-frame` renders the header, banner, composer, and hint row.
- `shell-truncation` keeps the header on one row when the terminal is narrow.
- `composer-echo` shows typed text in the composer.
- `composer-submit` accepts a prompt on return and queues a toast.

## How to get to it (user POV)

- Run `nightcode` in a terminal.
- Type any text, then press return.

## Driving it with the PTY harness

Preconditions:

- `bun install` has run at the repo root.
- The prerecorded script sends text first and presses return afterwards, so the composer has content
  before the submit stroke.

- **Launch and read the frame.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:hello from the terminal;0.7:\r;1.2:\e" --raw /tmp/nightcode-verify/shell/run.raw --expect "Queued: hello from the terminal"`.
  The driver prints `expect-ok: found 'Queued: hello from the terminal'`.
- **Prove the composer echo.** Run
  `grep -c "hello" /tmp/nightcode-verify/shell/run.raw`. The count is at least 3: the toast text plus the
  echoed characters, which the renderer writes with cursor positioning between them. A single contiguous
  match for the whole sentence is not expected in a raw stream.
- **Prove the shell chrome.** Run
  `grep -c "ask nightcode to do something" /tmp/nightcode-verify/shell/run.raw` and
  `grep -c "esc interrupt" /tmp/nightcode-verify/shell/run.raw`. Both counts are at least 1.
- **Prove the header.** Run
  `grep -c "Night Code 0.1.0" /tmp/nightcode-verify/shell/run.raw`. The count is 1, and the raw stream
  has no row longer than the terminal width.
- **Capture a screenshot.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:hello from the terminal;0.7:\r;1.2:\e" --cast /tmp/nightcode-verify/shell/run.cast`, then
  `agg --theme dracula --font-family "JetBrainsMono NF" --font-size 14 /tmp/nightcode-verify/shell/run.cast /tmp/nightcode-verify/shell/run.gif`, then
  `convert '/tmp/nightcode-verify/shell/run.gif[1]' -resize 60% /tmp/nightcode-verify/shell/shell.png`.
  Read the PNG back. It shows the banner, the composer with the typed text, and the toast.

## Gotchas

- The driver creates missing parent directories for `--raw` and `--cast`, so an artifact path like
  `/tmp/nightcode-verify/feature/run.raw` needs no `mkdir` first.
- The terminal size is fixed by the driver at 110 columns. A claim about wrapping is only valid at the
  recorded size, so record `--cols` with the artifact.
- `pressKeys` sends legacy bytes and the kitty parser drops a bare escape. Use the `\e` escape in the
  script, or the kitty helpers in a headless test.
- React schedules state updates on a later task. `tools/cli-pty.py` waits for idle output, but a headless
  test must call `settle()` before reading a frame.
- The header truncates when the working directory is long. A test that asserts a full-width version string
  fails in a deep checkout, so assert the brand prefix instead.
