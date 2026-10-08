#!/usr/bin/env bash
# Proves every commit on the current branch is green in isolation: typecheck, biome, tests, and a
# real-terminal boot. Each commit gets its own worktree, so a later commit cannot mask an earlier
# break.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
BASE="${BASE_REF:-origin/master}"
COMMITS=$(git rev-list --reverse "${BASE}..HEAD")
FAIL=0
for SHA in $COMMITS; do
  DIR="$ROOT/.worktrees/verify-$SHA"
  rm -rf "$DIR"
  mkdir -p "$ROOT/.worktrees"
  git worktree add -q --detach "$DIR" "$SHA" || { echo "worktree failed for $SHA"; FAIL=1; continue; }
  # Bun installs workspace dependencies per package, so the worktree borrows each node_modules.
  ln -s "$ROOT/node_modules" "$DIR/node_modules"
  for pkg in "$ROOT"/packages/*/node_modules; do
    [ -d "$pkg" ] && ln -s "$pkg" "$DIR/packages/$(basename "$(dirname "$pkg")")/node_modules"
  done
  (
    cd "$DIR"
    SUBJECT=$(git log -1 --format='%s' "$SHA")
    T=$(bun run typecheck >"/tmp/opencode/verify-$SHA-typecheck.log" 2>&1 && echo ok || echo FAIL)
    L=$(bunx biome check . >"/tmp/opencode/verify-$SHA-lint.log" 2>&1 && echo ok || echo FAIL)
    S=$(bun test packages >"/tmp/opencode/verify-$SHA-test.log" 2>&1 && echo ok || echo FAIL)
    P="skip"
    if [ -f "$DIR/packages/cli/src/index.tsx" ]; then
      if grep -q "Queued:" "$DIR/packages/cli/src/app.tsx" 2>/dev/null; then
        EXPECT="Queued: hello"
      else
        EXPECT="terminal coding agent"
      fi
      P=$(timeout 60 python3 tools/cli-pty.py --cmd "bun run --cwd packages/cli src/index.tsx" --script "0.8:hello;0.6:\\r" --expect "$EXPECT" >"/tmp/opencode/verify-$SHA-pty.log" 2>&1 && echo ok || echo FAIL)
    fi
    printf '%s  %-8s %-8s %-8s %-8s %s\n' "${SHA:0:9}" "$T" "$L" "$S" "$P" "$SUBJECT"
    [ "$T" = ok ] && [ "$L" = ok ] && [ "$S" = ok ] && [ "$P" = ok ] || echo "  ^ see /tmp/opencode/verify-$SHA-*.log"
  )
  git worktree remove --force "$DIR" >/dev/null 2>&1
done
exit $FAIL
