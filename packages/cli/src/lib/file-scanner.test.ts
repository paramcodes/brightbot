import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SCAN_MAX_RESULTS, scanFiles } from "./file-scanner.js"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nightcode-scan-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, contents = "x"): void {
  const target = join(root, path)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, contents)
}

/** A tree that carries every `.gitignore` shape a real repo uses. */
function buildRepo(): void {
  write(".gitignore", ["dist/", "node_modules/", "*.log", "!keep.log", "/root-only.txt"].join("\n"))
  write("README.md")
  write("keep.log")
  write("debug.log")
  write("root-only.txt")
  write("src/index.ts")
  write("src/nested/deep.ts")
  write("src/root-only.txt")
  write("dist/bundle.js")
  write("node_modules/dep/index.js")
  write(".git/config")
}

describe("scanFiles", () => {
  test("lists every tracked file under the root, relative to it", async () => {
    buildRepo()
    const files = await scanFiles(root)
    expect(files).toEqual([".gitignore", "README.md", "keep.log", "src/index.ts", "src/nested/deep.ts", "src/root-only.txt"])
  })

  test("the result is sorted, so the picker's order is not the filesystem's", async () => {
    buildRepo()
    const files = await scanFiles(root)
    expect(files).toEqual([...files].sort())
  })

  test("a directory-only pattern drops the directory and its contents", async () => {
    buildRepo()
    const files = await scanFiles(root)
    expect(files.some((path) => path.startsWith("dist/"))).toBe(false)
  })

  test("a negation keeps the file the surrounding pattern drops", async () => {
    buildRepo()
    const files = await scanFiles(root)
    expect(files).toContain("keep.log")
    expect(files).not.toContain("debug.log")
  })

  test("an anchored pattern only matches at the root", async () => {
    buildRepo()
    const files = await scanFiles(root)
    expect(files).not.toContain("root-only.txt")
    expect(files).toContain("src/root-only.txt")
  })

  test("node_modules is skipped even though the .gitignore also names it", async () => {
    buildRepo()
    write("node_modules/dep/package.json")
    const files = await scanFiles(root)
    expect(files.filter((path) => path.includes("node_modules"))).toEqual([])
  })

  test(".git is skipped even without a .gitignore naming it", async () => {
    write("index.ts")
    write(".git/objects/ab/cdef")
    const files = await scanFiles(root)
    expect(files).toEqual(["index.ts"])
  })

  test("a build directory nobody ignored is still skipped", async () => {
    write("index.ts")
    write("build/out.js")
    write("out/out.js")
    write("target/out.js")
    write("vendor/out.js")
    write(".next/out.js")
    write(".cache/out.js")
    const files = await scanFiles(root)
    expect(files).toEqual(["index.ts"])
  })

  test("the store directory a session started in the home directory would reach is skipped", async () => {
    write("index.ts")
    write(".nightcode/store.json")
    write(".nightcode/auth.json")
    const files = await scanFiles(root)
    expect(files).toEqual(["index.ts"])
  })

  test("a nested .gitignore is honoured inside its own directory only", async () => {
    write(".gitignore", "dist/\n")
    write("packages/cli/.gitignore", "dist/\n/only-here.txt\n")
    write("packages/cli/src/index.ts")
    write("packages/cli/dist/bundle.js")
    write("packages/cli/deep/dist/bundle.js")
    write("packages/cli/deep/nested/bundle.js")
    write("packages/cli/only-here.txt")
    write("packages/server/only-here.txt")
    const files = await scanFiles(root)
    expect(files).toEqual([
      ".gitignore",
      "packages/cli/.gitignore",
      "packages/cli/deep/nested/bundle.js",
      "packages/cli/src/index.ts",
      "packages/server/only-here.txt",
    ])
  })

  test("a nested negation overrides the shallower pattern, as git's precedence does", async () => {
    write(".gitignore", "*.log")
    write("packages/cli/.gitignore", "!keep.log")
    write("packages/cli/keep.log")
    write("packages/cli/drop.log")
    write("other/keep.log")
    const files = await scanFiles(root)
    expect(files).toEqual([".gitignore", "packages/cli/.gitignore", "packages/cli/keep.log"])
  })

  test("comments and blank lines in a .gitignore are not patterns", async () => {
    write(".gitignore", "# a comment\n\n   \n*.log\n")
    write("index.ts")
    write("debug.log")
    const files = await scanFiles(root)
    expect(files).toEqual([".gitignore", "index.ts"])
  })

  test("a .gitignore that cannot be read leaves the rest of the directory scannable", async () => {
    write("index.ts")
    mkdirSync(join(root, ".gitignore"))
    const files = await scanFiles(root)
    expect(files).toEqual(["index.ts"])
  })

  test("a root that does not exist leaves the picker empty instead of throwing", async () => {
    const files = await scanFiles(join(root, "no-such-directory"))
    expect(files).toEqual([])
  })

  test("a root that is a file leaves the picker empty instead of throwing", async () => {
    write("index.ts")
    expect(await scanFiles(join(root, "index.ts"))).toEqual([])
  })

  test("the cap truncates the sorted list, so the rows a user sees are the first ones", async () => {
    const excess = SCAN_MAX_RESULTS + 3
    for (let index = 0; index < excess; index += 1) write(`file-${String(index).padStart(6, "0")}.ts`)
    const files = await scanFiles(root)
    expect(files).toHaveLength(SCAN_MAX_RESULTS)
    expect(files[0]).toBe("file-000000.ts")
    expect(files[SCAN_MAX_RESULTS - 1]).toBe(`file-${String(SCAN_MAX_RESULTS - 1).padStart(6, "0")}.ts`)
    expect(files).toEqual([...files].sort())
  })
})
