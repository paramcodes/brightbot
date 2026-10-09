# Phase 5 design: modes, models, sessions, and mentions

Phase 5 of `tools/plan.json` (issue #24). This file records the structural decisions and where they
deviate from the plan.

## Problem

Four features land together, and two of them need seams the repo does not have yet. The live values
already exist in `preferences.json` (`mode`, `model`) and are rendered by `Header`, but `RootLayout`
reads `DEFAULT_PREFERENCES.mode` and `.model` directly, so neither has ever been live. `/sessions` and
`/models` are already advertised in `ROOT_COMMANDS` and already fall through to "is not wired up yet".
`Store` has no listing, and `/` opens a modal while `@` must filter inline, so the two pickers cannot
share one mechanism.

Constraints from the shipped code. Printable characters are dropped before the responder chain by
`isTextEntryKey`, so every typed `@` reaches only the focused editor. The composer's host renderable is
the source of truth between renders, because React short-circuits an equal `value` prop, so anything
that resets the composer must change the `key` or make the value differ. `theme` is the only live
preference field, and `ThemeProvider` opens its own `ConfigStore` instance.

## Shape

### One preferences owner

`Preferences` already declares `mode` and `model`, and `ConfigStore` already reads and rewrites the
whole file. The phase adds `context/PreferencesContext.tsx`, which opens ONE store instance and owns
`theme`, `mode`, and `model` behind setters, and deletes `ThemeContext.tsx`. Four consumers migrate.

The reason this is one context and not three is the write path: a second provider calling
`openConfigStore()` would hold a second instance over one file, and a whole-file rewrite from each is
two writers with no ordering. One owner removes the sharing rather than serializing it.
`useTheme()` survives as a selector over the same context so the render components do not churn.

`mode` narrows from `string` to `"plan" | "build"`, and `parsePreferences` validates it with the same
guard `isThemeName` already uses, so an unreadable file cannot put an unknown mode on screen.

### Modes

`shared/src/prompts/plan-mode.ts` and `build-mode.ts` hold one system prompt each, and
`systemPrompt(mode)` selects. The package's own description already promises prompts, and the directory
did not exist, so this is the phase that makes it true.

No new status bar. `Header` already renders `mode` and `model` cells and `RootLayout` already receives
them, so a second status surface would be two ways to show one thing. The mode cell becomes live, and
`tab` starts toggling the mode through the `useRootKeys` fallback, which is what the hint row has
advertised since Phase 2 with nothing behind it.

### Models

`shared/src/constants/models.ts` is a closed table of `{ id, label, provider, inputPerMillion,
outputPerMillion }`, and `/models` renders it through `DialogSearchList`, the one keyboard
implementation every modal list already uses. Selecting a row calls `setModel`, and `submit`'s session
create sends the live model rather than `DEFAULT_PREFERENCES.model`.

The ids match what the provider adapters can actually call, which is `claude-sonnet-4-5` and `gpt-5`
from commit 4.1, rather than the plan's older list. The price columns are data the operator owns, so
they ship as declared values and are called out for review rather than invented here.

### Sessions

`Store` gains `listSessions()` and `listMessages(sessionId)`. Both are reads and neither goes through
`serialize`, following `getSession`, whose comment already establishes that a read needs no chain. The
port's own widening note is the sanction.

The listing order is newest first in both implementations. The file store returns its array reversed,
because insertion order is its authoritative order and the reverse of it is the truth; `orderBy
createdAt` is a lie for it, since `Session.updatedAt` is written once at create and never updated
anywhere in the tree. `createdAt` is also not unique, so sorting by it can swap rows. That limitation
is documented rather than patched, and the hydrated transcript preserves arrival order rather than
sorting, for the same reason.

`ChatTransport` gains the two methods, because the port's own comment says it is "the only reason the
hooks know a server exists" and a hook that imported the client directly would make every hook test
need a server.

`useChatSession` gains `resume(session, rows)`. It follows `reset`'s shape exactly: abort anything in
flight, bump the `generation` ref so a late run from the previous conversation cannot write back, then
set both fields. `toChatMessages` drops `system` rows, because `ChatRole` is `user | assistant` and a
system row has no representation in the view vocabulary. Reasoning is NOT persisted: adding a field to
`Message` would hit the store's schema, which strips unknown keys and rewrites the file without them,
so it needs a version bump and a migration read rather than an optional field. That is a decision to
make deliberately, not to slip in beside a dialog.

### Mentions

`@` filters inline. There is no precedent in this repo and the palette's mechanism does not apply:
`/` opens a modal from an empty composer through a layer, while `@` is typed mid-text and the composer
must keep focus and keep accepting every printable key.

The enabling fact is on the input itself. `onKeyDown` on `<input>` fires for every keypress while it is
focused and before the buffer edits, and calling `preventDefault` on that event stops the composer from
acting on the key. So the picker takes `up`, `down`, `return`, and `escape` while the user types,
without a layer and without stealing printable characters. A responder layer returning `true` does not
do this: it has been measured that the editor still acts on the key anyway.

`lib/file-scanner.ts` walks with `Bun.Glob` and matches with the `ignore` package. The plan named
`fast-glob`, which does not read `.gitignore` at all, so the plan's stack would still have needed a
matcher. `ignore` is the canonical one, and negation, anchoring, and directory rules were each proved
by probe. `date-fns` is dropped for the same reason: `Intl.RelativeTimeFormat` and
`Intl.DateTimeFormat` cover it natively.

`core/mention.ts` holds the pure parts, so the interaction is testable without a terminal:
`activeMention(value, caret)` returns the active mention's span, matching an `@` that begins the text
or follows whitespace so that a typed email address does not open a picker, and `rankMentionMatches`
orders the scan's output.

`FileMentionMenu` renders as a sibling of `InputBar` in `RootLayout`, `position="absolute"` at a
position computed from the input's own screen coordinates plus the caret column. It does not use
`DialogSearchList`, whose `return` and `escape` handling would fight the composer's own submit binding
and whose layer cannot stop the composer from submitting.

Inserting the chosen path rewrites the composer value at the mention's start, and then resets
`cursorOffset` on the input ref explicitly, because the `value` setter moves the caret to the end of the
new text and the caret would otherwise jump.

## What this phase deliberately does not do

- No persisted reasoning, for the schema reason above.
- No `session.update`, so `updatedAt` stays write-once and "recent" means newest created.
- No pagination on either listing. The first session with a thousand turns is a Phase 6 problem.
- No server-side file scan. The picker reads the working directory the CLI is running in.
- No new status bar, and no second search implementation for the mention picker.

## Verification

Each commit is proved by `tools/verify-commits.sh` in its own worktree, as in phase 4. The mention
picker is the one part that needs the real terminal, because it depends on caret coordinates and on the
input's own key handling, so it is driven through `tools/cli-pty.py` as well as through the harness.
`@` must be sent through the kitty path, not legacy bytes, where it encodes as `ctrl+2`.
