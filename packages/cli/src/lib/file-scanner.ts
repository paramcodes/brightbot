import { lstatSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Glob } from "bun"
import ignore, { type Ignore } from "ignore"

/**
 * Rows one scan ever offers the picker. A large repo yields tens of thousands of files and a list
 * that long is no better a picker than none, so the scan is sorted and then cut here. The cut runs
 * after the sort, so the rows a user sees are the first `SCAN_MAX_RESULTS` of a deterministic
 * ordering rather than whichever ones the filesystem happened to yield first.
 */
export const SCAN_MAX_RESULTS = 5000

/**
 * Directories a `.gitignore` cannot keep out, because the repo that never wrote the rule still has
 * them: a generated `build` nobody ignored, a vendored `vendor`, or a `node_modules` inside a
 * subpackage. They are pruned by name during the walk, so enumerating a tree with hundreds of
 * thousands of generated files never happens. `.nightcode` is here because a session started in the
 * home directory would otherwise offer the user their own store as a mention.
 */
const ALWAYS_SKIP = new Set([".git", ".nightcode", "node_modules", "dist", "build", "out", "target", "vendor", ".next", ".cache"])

/**
 * Every mentionable file under `root`, relative to it, with directories excluded.
 *
 * The promise exists because a caller has to await a settlement that a synchronous walk cannot
 * report, and the walk stays synchronous because a tree deep enough to stall a frame is bounded by
 * `ALWAYS_SKIP` rather than by this being async.
 */
export async function scanFiles(root: string): Promise<string[]> {
  const files: string[] = []
  try {
    walk(root, root, ignore(), files)
    files.sort()
    return files.slice(0, SCAN_MAX_RESULTS)
  } catch {
    // A scan is a convenience, not a dependency. A root that is not a directory, a `.gitignore` that
    // cannot be read, or a permission error anywhere along the way leaves the picker empty rather
    // than taking the app down with it.
    return []
  }
}

function walk(root: string, directory: string, matcher: Ignore, files: string[]): void {
  const prefix = toPosix(relative(root, directory))
  const local = loadGitignore(directory, prefix, matcher)
  // One glob per directory rather than one `**/*` pattern for the tree: a single pattern cannot
  // prune a nested `node_modules`, and `Bun.Glob` has no scan-time filter to do it for us.
  for (const name of new Glob("*").scanSync({ cwd: directory, dot: true, onlyFiles: false })) {
    const path = prefix.length === 0 ? name : `${prefix}/${name}`
    let stats: ReturnType<typeof lstatSync>
    try {
      stats = lstatSync(join(directory, name))
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      if (!ALWAYS_SKIP.has(name) && !ignores(local, path, true)) walk(root, join(directory, name), local, files)
      continue
    }
    // A symlink is not a directory under `lstat`, so it is never descended into, and following one
    // could cycle forever. Skipping it trades a rare mention for a picker that always opens.
    if (stats.isFile() && !ignores(local, path, false)) files.push(path)
  }
}

function ignores(matcher: Ignore, path: string, isDirectory: boolean): boolean {
  // `ignore` reads a bare path as a file, so a directory-only rule like `dist/` reports the
  // directory itself as kept and only its contents as ignored. The trailing slash is what makes a
  // directory test answer the question the walk is asking.
  return matcher.ignores(isDirectory ? `${path}/` : path)
}

function loadGitignore(directory: string, prefix: string, matcher: Ignore): Ignore {
  let text: string
  try {
    text = readFileSync(join(directory, ".gitignore"), "utf8")
  } catch {
    // Either there is no `.gitignore` here or it cannot be read. Neither is a reason to abandon the
    // rest of the directory.
    return matcher
  }
  // Patterns are appended in descent order, so a deeper file overrides a shallower one, which is
  // git's own precedence.
  return matcher.add(prefixPatterns(text, prefix))
}

function prefixPatterns(text: string, prefix: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => prefixPattern(line, prefix))
}

function prefixPattern(line: string, prefix: string): string {
  // The root file is the case `ignore` was built for, so it is handed over untouched.
  if (prefix.length === 0) return line
  const negated = line.startsWith("!")
  const pattern = negated ? line.slice(1) : line
  const anchored = pattern.startsWith("/")
  const bare = anchored ? pattern.slice(1) : pattern
  // A bare slash names the directory itself, which the prefix already is.
  if (bare.length === 0) return line
  // An unanchored rule matches at any depth below its own directory, which is a globstar. An
  // anchored one matches only directly in it, which is the prefix alone.
  const body = anchored ? `${prefix}/${bare}` : `${prefix}/**/${bare}`
  return negated ? `!${body}` : body
}

function toPosix(path: string): string {
  return path.split(sep).join("/")
}
