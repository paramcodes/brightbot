# Phase 2 report: Navigation, Modals & Persistent Theming

Status: complete. All acceptance criteria hold.

- Branch: `phase-2-navigation`, checked out in `/home/param/Projects/nightcode/.worktrees/phase-2`
- Head: `4e127b4` (`feat(cli): add the memory router and session view (#13)`)
- Base: `b9807fb` (`origin/master`, Phase 1)
- Four commits, one per plan item, each green in isolation

## Commits

| SHA | Subject |
| --- | --- |
| `8164f6b` | `feat(cli): add persistent configuration and theme engine (#10)` |
| `0295584` | `feat(cli): add the reusable searchable dialog (#11)` |
| `1c07b17` | `feat(cli): add the root command menu (#12)` |
| `4e127b4` | `feat(cli): add the memory router and session view (#13)` |

## What was built

**2.1 Persistent config and theme engine.** `src/lib/config.ts` owns a `ConfigStore` with
`read()` and `update()`. The file is the only untrusted input, so `parsePreferences` type-checks
every field there and drops anything unknown. A missing or corrupt file yields the defaults.
`update()` reads, merges, and rewrites the whole file, so a second write never loses the first.
`src/styles/themes/` holds four palettes; dracula is re-exported from `src/styles/theme.ts` so the
existing `Theme` interface and its palette stay the single source of truth. `ThemeContext.tsx`
reads the store on mount and writes through it on `setTheme`.

**2.2 DialogSearchList.** The one keyboard implementation for modal lists. `useResponder`
registers a layer that consumes escape, return, up, and down; printable characters never reach the
layer because the responder chain only ever receives control keys, so typing in the filter is safe
by construction. `DialogBackdrop` owns the dimming and sits at `zIndex` 40, below the toast layer at
50, so shell feedback still reads through a modal.

**2.3 Root command menu.** A slash in an empty composer opens the palette. The trigger watches the
composer value, because the chain drops printable keys. Escape closes the palette and nothing else.

**2.4 Memory router and session view.** `src/router/routes.tsx` provides a two-route memory router
and `RouteView`. Submitting on Home appends a turn and navigates to Session, where the prompt is
visible. `/clear` empties the session and returns Home. `RootLayout.tsx` now owns the shell.

## Deviations from the brief

1. **Main worktree branch handling.** The brief said to create `phase-2-navigation` off the
   worktree HEAD. That branch was already checked out at the repo root, so `git checkout -b` in my
   worktree failed. I first used `git update-ref`, which left the root worktree's index pointing at
   commits whose files do not exist there. I then restored the root worktree to `b9807fb`, a clean
   state identical to `master` and `origin/master`, and attached `phase-2-navigation` to my
   worktree instead. `master` was never touched and no force-push happened.

2. **The composer's controlled `value` cannot be reset by prop change.** The host `<input>` owns
   its own text buffer and emits `input` with the new value. The parent's `value` prop is `"/"`,
   which is what triggered the palette, so React diffs `"/"` against `"/"` and emits no prop
   change; the slash survives. The palette clears the composer through a keyed remount. This is
   recorded in a comment at the call site.

3. **Escape after a Home submit shows "No generation to interrupt".** There is no generation to
   interrupt in Phase 2. The message is unchanged from Phase 1 and Phase 4 owns replacing it.

4. **The `/` palette swallows the slash instead of inserting it.** The palette absorbs everything
   typed in the same keystroke batch as the slash and uses it as the filter, so a fast paste of
   `/exit` filters to `/exit` rather than closing and reopening on stale text. This is why the
   dialog filter is a controlled prop.

5. **No react-router dependency added.** The brief said to use `createMemoryRouter` from
   react-router and also forbade new dependencies. react-router is absent from the lockfile, and
   the lockfile is outside my scope, so `routes.tsx` implements the two routes directly behind a
   `path`/`navigate` API. Migrating later is one file. The decision and the reason are in a comment.

## Theme decisions

Dracula is re-exported rather than duplicated. Nightfox, catppuccin, and monokai are new files
satisfying the same `Theme` interface. Theme selection persists through the config store, so the
choice survives restarts. `THEMES` is keyed by name, so `isThemeName` is a membership check and an
unknown value in the file falls back to the default.

## Commands and real output

Every command ran in `/home/param/Projects/nightcode/.worktrees/phase-2`.

```
$ bun run typecheck
$ tsc --noEmit -p tsconfig.json
exit=0
```

```
$ bunx biome check .
Checked 58 files in 117ms. No fixes applied.
Found 1 info.
exit=0
```

The single info is the pre-existing `biome.json` deprecation notice from Phase 1, unrelated to this
phase.

```
$ bun test packages
 60 pass
 0 fail
Ran 60 tests across 10 files. [2.83s]
```

Baseline before this phase was 31 pass. The suite grew by 29 tests.

```
$ bash tools/verify-commits.sh BASE_REF=origin/master
8164f6ba8  ok       ok       ok       ok       feat(cli): add persistent configuration and theme engine (#10)
02955847e  ok       ok       ok       ok       feat(cli): add the reusable searchable dialog (#11)
1c07b17de  ok       ok       ok       ok       feat(cli): add the root command menu (#12)
4e127b478  ok       ok       ok       ok       feat(cli): add the memory router and session view (#13)
```

Each row is typecheck, lint, tests, and a real-PTY boot at that commit in its own worktree.

## Verification of the real artifact

Run directory: `/tmp/nightcode-verify/phase2/`. `STATUS` contains `pass`.

**Command menu, driven in a real PTY.** The proof brief's exact command:

```
$ python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
    --script "1.0:/;1.0:mode" --expect "models" \
    --raw /tmp/nightcode-verify/phase2/menu.raw
captured 13 chunks, 20570 bytes, app exit code=0
expect-ok: found 'models'
```

Counts in `menu.raw`: `/clear` 1, `/sessions` 1, `/models` 1, `/agents` 1, `/usage` 1, `/exit` 1,
`filter commands` 1, `switch the active model` 2, `type to filter` 1.

**Home to Session, driven in a real PTY.** The proof brief's exact command:

```
$ python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
    --script "1.0:hello phase two;0.7:\r;1.0:\e" --expect "hello phase two" \
    --cast /tmp/nightcode-verify/phase2/session.cast
captured 10 chunks, 14595 bytes, app exit code=0
expect-ok: found 'hello phase two'
```

A second identical run captured the raw stream with the trailing escape removed, so the session
frame stays on screen:

```
$ python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
    --script "1.0:hello phase two;0.7:\r;1.5:x" --expect "no response yet" \
    --cast /tmp/nightcode-verify/phase2/session-view.cast \
    --raw /tmp/nightcode-verify/phase2/session-view.raw
captured 10 chunks, 14147 bytes, app exit code=0
expect-ok: found 'no response yet'
```

The raw stream contains the Session view rendering `you` then `> hello phase two` at row 3, with
the prompt in dracula `fg` (`38;2;248;248;242`). Counts: `hello phase two` 3, `no response yet` 1,
and no `/` command text at all, which confirms the route change rather than an overlay.

**Screenshots, read back.** Per the verification skill:

```
$ agg --theme dracula --font-family "JetBrainsMono NF" --font-size 14 \
    /tmp/nightcode-verify/phase2/session.cast /tmp/nightcode-verify/phase2/session.gif
5 / 5 [======================================================]  100.00 %  9.78 / s

$ convert '/tmp/nightcode-verify/phase2/session.gif[2]' -resize 60% \
    /tmp/nightcode-verify/phase2/shell.png
```

I read `shell.png` back. It shows the Night Code banner, the header row
`Night Code 0.1.0 | plan | claude-3-5-sonnet | idle`, the tagline, `theme: dracula`, the composer
holding `> hello phase two`, and the hint row.

`agg` composites five frames and frame 2 is the pre-submit composer state, so I also converted
frame 3 and the last frame of the no-escape run:

- `/tmp/nightcode-verify/phase2/session-frame3.png` shows the composer cleared to the placeholder.
- `/tmp/nightcode-verify/phase2/session-late.png` shows the Session view: the turn block with
  `you`, `> hello phase two`, then `nightcode` and `no response yet`.

**Theme persistence, proved on the real artifact.** With a seeded
`/tmp/nightcode-verify/phase2/home-theme/preferences.json` containing `{"theme": "catppuccin"}`, the
booted CLI painted catppuccin:

```
$ NIGHTCODE_HOME=/tmp/nightcode-verify/phase2/home-theme \
    python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" \
    --script "1.0:/" --cast /tmp/nightcode-verify/phase2/theme.cast \
    --raw /tmp/nightcode-verify/phase2/theme.raw
captured 11 chunks, 19924 bytes, app exit code=0
```

Counts in `theme.raw`: catppuccin accent `38;2;137;180;250` 47 times, dracula accent
`38;2;139;233;253` 0 times, and the line `theme: catppuccin` present. The choice was read from disk
on boot with no interaction. `/tmp/nightcode-verify/phase2/theme.png` shows the palette rendered in
catppuccin blue.

## Files written

All under `packages/cli/src` and `packages/cli/test`. `package.json`, `bun.lock`, `README.md`,
`AGENTS.md`, `docs/**`, `.github/**`, `orchestrate/**`, `tools/**`, `src/core/**`,
`src/components/toast/**`, `Header.tsx`, `Banner.tsx`, `InputBar.tsx`, `src/styles/theme.ts`, and
`src/styles/box.ts` are untouched. `node_modules` symlinks are gitignored already.

## Follow-ups

- The root worktree now sits detached at `b9807fb`. If the coordinator wants it back on a branch,
  that is a local, reversible checkout.
- A `todo.md` was not created. The worktree is inside a git repo, but the brief named `todo.md` as
  an off-limits path, so the step list lives in this report instead.
- Phase 4 should replace the "No generation to interrupt" toast and the empty assistant block.
- Phase 5 owns `/sessions` and `/models`; Phase 7 owns `/usage`. Until then those three commands
  push a "not wired up yet" toast, which a test asserts.
- If react-router becomes available, `routes.tsx` is the only file that changes.

## Proof artifacts

| Path | What it is |
| --- | --- |
| `/tmp/nightcode-verify/phase2/STATUS` | `pass` |
| `/tmp/nightcode-verify/phase2/menu.raw` | Raw PTY bytes, command menu |
| `/tmp/nightcode-verify/phase2/session.cast` | Cast of the Home-to-Session drive |
| `/tmp/nightcode-verify/phase2/session.gif` | Agg render of that cast |
| `/tmp/nightcode-verify/phase2/shell.png` | Screenshot of frame 2, read back |
| `/tmp/nightcode-verify/phase2/session-view.raw` | Raw bytes with no trailing escape |
| `/tmp/nightcode-verify/phase2/session-view.cast` | Cast of that drive |
| `/tmp/nightcode-verify/phase2/session-frame3.png` | Composer cleared after submit |
| `/tmp/nightcode-verify/phase2/session-late.png` | Session view with the prompt visible |
| `/tmp/nightcode-verify/phase2/session-raw.png` | Full-resolution session frame |
| `/tmp/nightcode-verify/phase2/theme.raw` | Raw bytes, catppuccin read from disk |
| `/tmp/nightcode-verify/phase2/theme.png` | Palette rendered in catppuccin, read back |
| `/tmp/nightcode-verify/phase2/commit2*.raw` | Per-commit PTY boot evidence |
