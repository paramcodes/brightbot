/** The root palette catalog. */
export interface Command {
  id: string
  name: string
  summary: string
}

export const ROOT_COMMANDS: readonly Command[] = [
  { id: "clear", name: "/clear", summary: "clear the composer" },
  { id: "sessions", name: "/sessions", summary: "resume a saved session" },
  { id: "models", name: "/models", summary: "switch the active model" },
  { id: "agents", name: "/agents", summary: "switch the active agent" },
  { id: "usage", name: "/usage", summary: "show credits and limits" },
  { id: "upgrade", name: "/upgrade", summary: "add credits" },
  { id: "exit", name: "/exit", summary: "quit nightcode" },
]
