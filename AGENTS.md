# Night Code for agents

Build and verification commands for anyone (human or agent) working in this repository. Run them from
the repository root.

| Intent | Command |
| --- | --- |
| Install | `bun install` |
| Run the CLI | `bun run dev` |
| Typecheck every package | `bun run typecheck` |
| Lint and format | `bunx biome check .` and `bunx biome check --write .` |
| Unit and TUI tests | `bun test packages` |
| Regenerate the feature map | `bun run tools/feature-map.ts` |

## Layout

```
packages/cli       OpenTUI React terminal client
packages/shared    Contracts shared by the client and the server: branding, paths, schemas, prompts, tools
packages/server    Hono backend (SSE chat relay, auth, persistence, billing meters)
tools/             Repo tooling: plan data, issue creation, feature map, PTY driver
docs/              Feature map, phase status, verification skill
```

## Conventions that are not optional

- **TUI JSX uses lowercase intrinsic tags** (`<box>`, `<text>`, `<input>`) with `jsxImportSource`
  pointing at `@opentui/react`. There is no DOM and no `<div>`.
- **The responder chain sees control keys only.** Printable characters belong to the focused editor.
  That single rule is what keeps a slash-command palette from firing while the user types.
- **Every external dependency sits behind a port with a local default.** LLM provider, store, auth, and
  credits all boot with no secrets. A test never needs a network call to prove a feature.
- **Tests assert observable behavior against a literal expected value.** If a test would still pass
  when every import returned `undefined`, delete it.
- **Comments name a non-obvious why or they do not exist.**
- **No code path may require a secret to start.**

## Testing the TUI

Headless tests render the real component tree through `@opentui/react/test-utils` with the kitty
keyboard protocol on. Two rules make them deterministic:

1. Every control key goes through the kitty-encoding helpers (`pressEscape`, `pressEnter`,
   `pressArrow`). `pressKeys` sends legacy bytes and the kitty parser drops a bare `escape`.
2. After a keypress, `settle()` yields a macro-task before `flush()`. React schedules the update, and
   `flush()` alone does not yield the event loop, so a frame captured immediately shows the previous
   render.

`tools/cli-pty.py` drives the real binary in a real pseudo-terminal when a test must prove the
artifact a user runs, not a rendered tree.
