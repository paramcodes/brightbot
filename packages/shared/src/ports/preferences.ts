/**
 * The two ways the agent behaves.
 *
 * This lives in `ports` because the CLI renders it, the prompts are chosen by it, and the chat route
 * will eventually resolve a provider from it, so all three need the same union rather than three
 * copies of the same two strings.
 */
export const AGENT_MODES = ["plan", "build"] as const

export type AgentMode = (typeof AGENT_MODES)[number]

/** Shaped like `isThemeName`: the file is untrusted, so a raw string is narrowed here or nowhere. */
export function isAgentMode(value: string): value is AgentMode {
  return (AGENT_MODES as readonly string[]).includes(value)
}
