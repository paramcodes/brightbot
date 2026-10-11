import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve, sep } from "node:path"

/**
 * Whether a path is the root or something inside it.
 *
 * `root` itself is allowed, and a prefix test on its own would refuse it. The separator is part of the
 * bound so that `/srv/app-other` is not inside `/srv/app`.
 */
function bounds(root: string, candidate: string): boolean {
  const start = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(start)
}

/**
 * What a path inside the working directory is, and what it is not.
 *
 * Every tool resolves its argument through here, so the containment is one decision in one place
 * rather than a check each executor remembers to make.
 *
 * An absolute path is a refusal rather than a reinterpretation. Resolving `/etc/passwd` against the
 * working directory would silently mean something the caller did not say, and a caller that asked for
 * an absolute path is a caller that understood the contract differently.
 *
 * A symlink that points out of the root is a refusal too. Testing only the path would let `link.txt`
 * name a file the root does not contain, so the real target is resolved and tested as well.
 */
export function resolveWithin(root: string, target: string): string | null {
  if (isAbsolute(target)) return null
  const resolved = resolve(root, target)
  if (!bounds(root, resolved)) return null
  if (!exists(resolved)) return bounds(root, resolved) ? resolved : null
  try {
    const real = realpathSync(resolved)
    return bounds(root, real) ? resolved : null
  } catch {
    // A path that cannot be resolved is treated as absent, which is what the caller's next check reports.
    return resolved
  }
}

/** The working directory every tool runs against. Read per call, because the CLI is one process. */
export function toolRoot(): string {
  return process.cwd()
}

/** Makes the directories a path passes through, so `write_file` can create `a/b/c.txt`. */
export function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

/** Whether a path resolves to something, without following a symlink that is not there. */
export function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Whether a path is a directory, without following a symlink that might cycle. */
export function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The whole file as text, or the system's own refusal as a string. */
export function readText(path: string): string {
  return readFileSync(path, "utf8")
}

/** Replaces a file's whole content, creating it when it is not there. */
export function writeText(path: string, content: string): void {
  writeFileSync(path, content, "utf8")
}
