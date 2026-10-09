# Phase 5 report: Agent Modes, Session Resumption & File Mentions

Status: complete. PR [#54](https://github.com/paramcodes/brightbot/pull/54), CI green, awaiting merge.

- Branch: `phase-5-modes-and-sessions`
- Base: `033ee21` (`origin/master`, the feature-map fix, after Phase 4 merged)
- Seven commits, each green in isolation through `tools/verify-commits.sh`

## Commits

| SHA | Subject |
| --- | --- |
| `22cc488` | `feat(cli): make plan and build mode live, with their prompts (#25)` |
| `2b12604` | `feat(cli): let the pick the model, with pricing (#26)` |
| `f24a38b` | `fix: let the chosen model name its provider, and default to a callable one` |
| `5f35972` | `feat(cli): resume a saved session from the store (#27)` |
| `da2ee58` | `feat(cli): mention a file with @ and pick it from what git tracks (#28)` |
| `20b28bb` | `docs: name what phase 5 left behind` |
| `7c8d6ea` | `docs: mark phase 5 shipped in the feature map` |

## What was built

**5.1 Modes.** `Preferences` already declared `mode` and `model` and `ConfigStore` already rewrote the whole file, so the phase wired the live values rather than adding new state. One `PreferencesProvider` owns theme, mode, and model behind one store instance, replacing `ThemeProvider` and its test. `mode` narrows from `string` to `"plan" | "build"` with a guard in `parsePreferences` shaped like `isThemeName`, so an unreadable file cannot put an unknown mode on screen. `tab` now toggles the mode, which is what the hint row has advertised since Phase 2 with nothing behind it.

The prompts live in `packages/shared/src/prompts/`, a directory the package's own description promised and did not have.

**5.2 Models.** A closed catalog of six ids, each one the Phase 4 provider adapters can actually call, with per-million pricing. `/models` renders it through `DialogSearchList`, the one keyboard implementation every modal list already uses. The chosen model is written through to the session create, which matters because the route reads `session.model` to resolve the provider.

**5.3 Resume.** `Store` grows `listSessions` and `listMessages`, both reads and both outside the `serialize` chain, following `getSession`. `/sessions` opens a picker, and `resume()` hydrates the transcript by following `reset`'s shape exactly: abort, bump the generation ref, set both fields.

**5.4 Mentions.** `@` filters the files git would track. The mechanism is the composer's own `onKeyDown`, which fires before the buffer edits, so `preventDefault` on it stops the composer acting on the key. The global keyboard listener runs first, so `useRootKeys` stands down for `escape` and `tab` while a mention is live.

## Decisions a reviewer should push on

**`@` is not a modal.** Printable characters are dropped before the responder chain, so nothing in the chain can see an `@`, and a responder layer returning `true` does not stop the focused editor from acting on the key anyway. That second fact was measured, not assumed, and it is the reason the picker is not a `DialogSearchList`.

**The listing does not sort.** `Session.updatedAt` is written once at create and never updated anywhere in the tree (there is no `session.update`), so ordering by it lists by creation time under a name that promises recency. `createdAt` is not unique either, because the file store writes millisecond ISO strings and two overlapping calls can land on the same value. The file store returns its array reversed, which is the truth, and the hydrated transcript preserves arrival order.

**No persisted reasoning.** The store's document schema is a plain `z.object`, so `.parse` strips a key it does not declare and the next `appendMessage` writes the file without it. A new `Message` field therefore needs a `version: 2` variant and a migration read, not an optional field. Phase 5 could have slipped reasoning in beside a dialog and did not.

**`fast-glob` and `date-fns` were dropped.** `fast-glob` does not read `.gitignore`, so the plan's stack would still have needed a matcher. The scan walks with `Bun.Glob` and matches with the `ignore` package, whose negation, anchoring, and directory rules were each proved by probe. `Intl.RelativeTimeFormat` covers timestamps natively.

**No new status bar.** `Header` already renders mode and model cells and `RootLayout` already receives them. A second status surface would be two ways to show one thing.

## A tooling fix that will matter again

`tools/verify-commits.sh` borrowed each package's `node_modules` as one directory link, and each of those symlinks `@nightcode/shared` back at the live `packages/shared`. Every worktree therefore typechecked against shared's latest source rather than the copy in the commit under test. That is why Phase 4's dependency bump had to be folded into its consumer, and why Phase 5's first three commits failed a clean verification run before the fix. The borrow is now per entry with workspace packages resolved to the worktree's own copy, so a widening breaks the commits after it and nothing else.

## Where the build deviated from the plan

Four places, all recorded in `docs/phase-5-design.md`: one preferences context instead of the plan's two, no `StatusBar.tsx`, no `date-fns`, and `core/mention.ts` as a new module the plan did not name.

## Verification

`tools/verify-commits.sh` green on all seven commits. `bun test packages` is 229 pass, 0 fail. Three real-terminal PTY drives cover the mode toggle, the model picker, the resume, and the `@` mention with an explicit caret assertion.

The mutation proofs that matter: removing `preventDefault` from the `return` branch breaks three tests, removing the whitespace rule in `activeMention` breaks three more including the email-address case, and removing the caret restore breaks one test that only proves anything with text after the mention.

Two defects the process caught that a unit test would have missed. The `tab`-flips-the-mode bug was found by a PTY drive and not by the harness, because the global listener runs before the input's own handler. The mode assertion passing in the checkout and hanging in the worktree is the same header-truncation trap Phase 4 hit, which is why `Header`'s cells are now never asserted at the default viewport.

## Open risks

- `systemPrompt` is exported and unreferenced. `ChatRequest` has no system field, so the mode changes nothing the model is told. Phase 6's first seam.
- The file scan is synchronous inside an async function, bounded by the skip list rather than by an await. A huge non-ignored directory is the case to measure.
- Prices are a snapshot read from both providers' pricing pages on 2026-10-10 at standard tier, with cache and batch rates not modelled.
- `MODEL_IDS` and the catalog's `provider` field have no consumer yet.
