import type { AgentMode } from "../ports/preferences.js"
import { BUILD_MODE_PROMPT } from "./build-mode.js"
import { PLAN_MODE_PROMPT } from "./plan-mode.js"

export { BUILD_MODE_PROMPT } from "./build-mode.js"
export { PLAN_MODE_PROMPT } from "./plan-mode.js"

/**
 * The system prompt for a mode.
 *
 * Exhaustive on purpose: a third mode added to `AgentMode` fails this switch rather than silently
 * falling through to a prompt that does not describe it.
 */
export function systemPrompt(mode: AgentMode): string {
  switch (mode) {
    case "plan":
      return PLAN_MODE_PROMPT
    case "build":
      return BUILD_MODE_PROMPT
    default: {
      const unhandled: never = mode
      throw new Error(`No system prompt for the mode ${JSON.stringify(unhandled)}`)
    }
  }
}
