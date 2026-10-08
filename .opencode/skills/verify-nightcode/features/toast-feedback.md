# Toast feedback

Toasts give non-blocking feedback for background events without touching the conversation stream. A toast
appears as a bordered overlay, dismisses on demand, and clears itself after its duration.

## Sub-features

- `toast-push` shows a toast with an icon and a colored border for its kind.
- `toast-dismiss` removes a toast when a control key asks for it.
- `toast-auto-dismiss` clears a toast after its own duration.

## How to get to it (user POV)

- Submit a prompt with return: a toast reports that the prompt was queued.
- Press escape with no generation running: a toast reports there is nothing to interrupt.
- Wait: a toast clears itself after its duration.

## Driving it with the PTY harness

Preconditions:

- `bun install` has run at the repo root.
- The submit toast and the escape toast come from two different drives, so record which drive produced
  which transcript.

- **Prove the submit toast.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:hello from the terminal;0.7:\r;1.2:\e" --expect "Queued: hello from the terminal"`.
  The toast text names the queued prompt.
- **Prove the escape toast.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:\e" --expect "No generation to interrupt"`.
- **Prove the overlay position.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:hello from the terminal;0.7:\r" --raw /tmp/nightcode-verify/toast/run.raw`
  and then render the screenshot from `features/shell-and-composer.md`. The toast box sits in the top-right
  of the frame, below the header row.
- **Prove auto-dismiss and dismiss in the headless harness.** Run
  `bun test packages/cli/src/components/toast`. The suite pushes a toast, asserts the rendered line, presses
  escape to dismiss, and waits out a short duration to assert the auto-dismiss path.

## Gotchas

- The toast overlay is drawn above the shell. A transcript grep proves the text exists, but not that the
  overlay is layered correctly. Use the rendered PNG for any layering claim.
- Auto-dismiss uses real timers. A headless test asserts on a short duration and a real wait; a fake clock
  that never advances proves nothing.
- A toast with `durationMs: 0` never auto-dismisses. Use an explicit dismiss for that case, and do not
  claim it clears itself.
