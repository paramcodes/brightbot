import { describe, expect, test } from "bun:test"
import { activeMention, MENTION_LIMIT, rankMatches, replaceMention } from "./mention.js"

describe("activeMention", () => {
  test("finds the mention right after the @", () => {
    expect(activeMention("@src/", 5)).toEqual({ start: 0, query: "src/" })
  })

  test("finds the mention while the query is still one character", () => {
    expect(activeMention("@s", 2)).toEqual({ start: 0, query: "s" })
  })

  test("finds a mention that opens mid-text after whitespace", () => {
    expect(activeMention("read @packages/", 15)).toEqual({ start: 5, query: "packages/" })
  })

  test("finds a mention that opens after a newline", () => {
    expect(activeMention("first line\n@docs", 16)).toEqual({ start: 11, query: "docs" })
  })

  test("a bare @ with nothing typed yet is a mention with an empty query", () => {
    expect(activeMention("hello @", 7)).toEqual({ start: 6, query: "" })
  })

  test("an @ inside a word does not open a mention", () => {
    expect(activeMention("a@b", 3)).toBeNull()
  })

  test("an @ inside a longer word does not open a mention", () => {
    expect(activeMention("look@src/", 9)).toBeNull()
  })

  test("a typed email address does not open a mention", () => {
    expect(activeMention("mail me at user@example.com", 27)).toBeNull()
  })

  test("an email address already on screen does not open a mention once text follows it", () => {
    expect(activeMention("user@example.com and more", 24)).toBeNull()
  })

  test("the caret before the @ is in no mention", () => {
    expect(activeMention("@src/", 0)).toBeNull()
  })

  test("the caret sitting on the @ is in no mention", () => {
    expect(activeMention("read @packages/", 5)).toBeNull()
  })

  test("the caret past a whitespace boundary is in no mention", () => {
    expect(activeMention("@src/ and more", 14)).toBeNull()
  })

  test("the caret past a boundary with an earlier @ still open reports no mention", () => {
    expect(activeMention("@a b", 4)).toBeNull()
  })

  test("a caret beyond the text is in no mention", () => {
    expect(activeMention("@src/", 99)).toBeNull()
  })

  test("text with no @ at all is in no mention", () => {
    expect(activeMention("read package.json", 17)).toBeNull()
  })
})

describe("replaceMention", () => {
  test("replaces the whole span when the @ is at the start", () => {
    expect(replaceMention("@src/", { start: 0, query: "src/" }, "src/index.ts")).toEqual({
      value: "src/index.ts ",
      caret: 13,
    })
  })

  test("keeps the text before the @ and drops the query", () => {
    const result = replaceMention("look at @packa", { start: 8, query: "packa" }, "packages/cli/src/lib/file-scanner.ts")
    expect(result).toEqual({
      value: "look at packages/cli/src/lib/file-scanner.ts ",
      caret: 45,
    })
  })

  test("keeps the text after the span", () => {
    expect(replaceMention("@src/ please", { start: 0, query: "src/" }, "src/index.ts")).toEqual({
      value: "src/index.ts  please",
      caret: 13,
    })
  })
})

describe("rankMatches", () => {
  const paths = ["src/index.ts", "src/lib/file-scanner.ts", "packages/cli/package.json", "docs/phase-5-design.md", "README.md"]

  test("an empty query returns every path, alphabetically", () => {
    expect(rankMatches(paths, "", 10)).toEqual([
      "README.md",
      "docs/phase-5-design.md",
      "packages/cli/package.json",
      "src/index.ts",
      "src/lib/file-scanner.ts",
    ])
  })

  test("a basename match outranks the same match deeper in the path", () => {
    expect(rankMatches(paths, "index", 10)).toEqual(["src/index.ts"])
  })

  test("a match only the basename carries outranks a match in the directory", () => {
    const both = ["docs/readme.md", "README.md"]
    expect(rankMatches(both, "readme", 10)).toEqual(["README.md", "docs/readme.md"])
  })

  test("a basename match outranks a match the path only carries in a directory", () => {
    const both = ["docs/phase-5-design.md", "phase/notes.txt"]
    expect(rankMatches(both, "phase", 10)).toEqual(["docs/phase-5-design.md", "phase/notes.txt"])
  })

  test("matching is case insensitive", () => {
    expect(rankMatches(["README.md"], "readme", 10)).toEqual(["README.md"])
  })

  test("the limit truncates the ranked list", () => {
    expect(rankMatches(paths, "", 2)).toEqual(["README.md", "docs/phase-5-design.md"])
  })

  test("a query that matches nothing returns nothing", () => {
    expect(rankMatches(paths, "zzzz", 10)).toEqual([])
  })

  test("a path fragment match is found anywhere in the path", () => {
    expect(rankMatches(paths, "scanner", 10)).toEqual(["src/lib/file-scanner.ts"])
  })

  test("MENTION_LIMIT is the row count the menu is sized for", () => {
    expect(rankMatches(paths, "", MENTION_LIMIT)).toHaveLength(paths.length)
  })
})
