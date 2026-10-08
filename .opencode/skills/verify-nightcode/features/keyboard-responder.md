# Keyboard responder chain

The responder chain owns every control key in Night Code. Printable characters belong to the focused
editor, so typing in an input can never fire a shortcut. Layers pushed on the chain see a key before the
layers below them, and a layer that consumes a key hides it from everything else. ctrl+c leaves the app
through its own exit path instead of dying on a signal.

## Sub-features

- `chain-unhandled` delivers an unconsumed control key to the root handler.
- `chain-order` delivers to the top layer before lower layers.
- `chain-consume` hides a consumed key from lower layers and the root handler.
- `chain-text-entry` never routes a printable key into the chain.
- `exit-clean` exits on its own path on ctrl+c and restores the terminal.

## How to get to it (user POV)

- Press escape, an arrow key, or return while nothing else owns the keyboard.
- Press ctrl+c to quit.
- Type any character: it goes into the composer, never into a shortcut.

## Driving it with the PTY harness

Preconditions:

- `bun install` has run at the repo root.
- An interrupt drive must go through `tools/cli-pty.py`, which reaps the child and reports its exit status.

- **Prove a clean ctrl+c from the real app.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:hello;0.6:\r;1.0:\x03" --raw /tmp/nightcode-verify/keyboard/run.raw`.
  The last line reads `app exit code=0`. `app exit signaled signo=2` is a failure: the app died on SIGINT
  instead of leaving through its own path.
- **Prove escape feedback.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:\e" --expect "No generation to interrupt"`.
  The driver prints `expect-ok: found 'No generation to interrupt'`.
- **Prove the chain does not steal text.** Run
  `python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "1.0:qwerty" --expect "qwerty" --raw /tmp/nightcode-verify/keyboard/text.raw`.
  The typed text appears in the composer and no toast appears, because printable keys never reach the chain.
- **Prove layer order and consumption in the headless harness.** Run
  `bun test packages/cli/src/core/responder`. The suite asserts the exact visible line after each keypress:
  top layer before lower layers, and a consuming layer hiding the key from the rest.

## Gotchas

- A bare escape byte is dropped by the kitty parser. In the PTY script use `\e`; in a headless test use
  `mockInput.pressEscape()`. `pressKeys(["ESCAPE"])` sends a legacy byte and the event never arrives.
- ctrl+c is delivered by legacy terminals as ESC+ETX, which the key parser reports with both ctrl and meta
  set. `keyToken` collapses that form, so a test of the chain must use the token `ctrl+c`, not `c`.
- A test renderer created without `exitOnCtrlC: false` tears the screen down on ctrl+c, leaving an empty
  frame. The harness sets it, and the app must not double-handle the key.
- The headless harness needs a macro-task tick after a keypress before a frame is read, or the frame shows
  the previous render.
