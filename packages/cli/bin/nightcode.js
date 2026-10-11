#!/usr/bin/env bun
/**
 * The command a user runs.
 *
 * A shim rather than a wrapper: there is no build step in this repo, so the entry is the source and
 * this file exists to be the thing `package.json`'s `bin` points at. It does no work of its own,
 * because work done here would be work the non-tty smoke test cannot see, and that test is what
 * keeps the guard honest.
 */
import "../src/index.tsx"
