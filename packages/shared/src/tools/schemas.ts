import { z } from "zod"
import type { AgentMode } from "../ports/preferences.js"

/**
 * The tools that only read.
 *
 * They are a separate tuple rather than a flag on each tool, because the mode switch needs to hand
 * out the whole set and a predicate per tool would put the same decision in two places.
 */
export const READ_ONLY_TOOLS = ["read_file", "list_directory", "glob", "grep"] as const
export type ReadOnlyToolName = (typeof READ_ONLY_TOOLS)[number]

/** The tools that change the machine they run on. Each one is gated behind a confirmation. */
export const WRITE_TOOLS = ["write_file", "edit_file", "bash"] as const
export type WriteToolName = (typeof WRITE_TOOLS)[number]

export const TOOL_NAMES = [...READ_ONLY_TOOLS, ...WRITE_TOOLS] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const toolNameSchema = z.enum(TOOL_NAMES)

/**
 * What each tool takes, and nothing more.
 *
 * The CLI owns the working directory, the timeout, and any cap, so none of those are fields the
 * model has to invent. A field the model must always send the same value for is a field that only
 * adds a way to get it wrong.
 */
export const toolSchemas = {
  read_file: z.object({
    /** Relative to the working directory, and never above it. */
    path: z.string().min(1),
  }),
  write_file: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  edit_file: z.object({
    path: z.string().min(1),
    /** Must appear exactly once in the file, or the edit is refused rather than approximated. */
    search: z.string().min(1),
    replace: z.string(),
  }),
  list_directory: z.object({
    path: z.string().min(1),
  }),
  glob: z.object({
    pattern: z.string().min(1),
  }),
  grep: z.object({
    pattern: z.string().min(1),
  }),
  bash: z.object({
    command: z.string().min(1),
  }),
} satisfies Record<ToolName, z.ZodObject>

/**
 * One sentence per tool, read by the model.
 *
 * They live beside the schemas rather than in the server's tool definitions, because a description
 * that disagrees with the schema it describes is a description of a tool that does not exist.
 */
export const toolDescriptions: Record<ToolName, string> = {
  read_file: "Read a file under the working directory and return its text. Use this before editing a file you have not read.",
  write_file: "Create or replace a file under the working directory with the given text.",
  edit_file: "Replace the one occurrence of search with replace in a file. The edit is refused when search does not appear exactly once.",
  list_directory: "List the entries of a directory under the working directory, one per line, with directories marked by a trailing slash.",
  glob: "Find files whose path matches a glob pattern such as packages/**/*.ts. Ignored files are not returned.",
  grep: "Find lines matching a regular expression across the working directory. Returns path, line number, and line text.",
  bash: "Run a shell command in the working directory and return its combined stdout and stderr.",
}

/**
 * What a mode is allowed to ask for.
 *
 * Plan mode promised read-only discovery and the system prompt already says so. Handing out the
 * capability by mode is what turns that promise into a rule rather than a request, so a caller that
 * switches to build mode asks a different question rather than the same one more emphatically.
 */
export function toolsForMode(mode: AgentMode): readonly ToolName[] {
  switch (mode) {
    case "plan":
      return READ_ONLY_TOOLS
    case "build":
      return TOOL_NAMES
    default: {
      const unhandled: never = mode
      throw new Error(`No tool set for the mode ${JSON.stringify(unhandled)}`)
    }
  }
}
