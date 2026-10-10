import { spawn } from "node:child_process"
import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { login } from "../auth/flow.js"
import { openTokenStore } from "../auth/token-storage.js"

/**
 * `nightcode login`, the command a human runs before their first turn.
 *
 * The flow is the same one the browser drives, so this command owns only the parts the shell owns:
 * which token store is written, which browser opener is used, and what the exit code says.
 */
export async function loginCommand(options: { printUrl?: boolean } = {}): Promise<number> {
  const store = openTokenStore()
  const print = (line: string): void => {
    process.stdout.write(`${line}\n`)
  }

  const outcome = await login({
    store,
    openBrowser: (url) => openBrowser(url, options),
  })

  if (!outcome.ok) {
    process.stderr.write(`${outcome.reason}\n`)
    return 1
  }
  print(`Signed in as ${outcome.email}.`)
  print(`The token is in ${store.path}`)
  if (process.env[NIGHTCODE_HOME_ENV] === undefined) print(`Set ${NIGHTCODE_HOME_ENV} to move it.`)
  return 0
}

/**
 * Opens the system browser.
 *
 * The opener is chosen by the OS rather than by the shell the user happens to have, and the URL is
 * passed as one argument so it is never interpreted as a shell command. A caller that cannot open a
 * browser gets the URL on its own stream, because a login that hangs on a missing browser is a login
 * that looks broken rather than one that needs a manual step.
 */
function openBrowser(url: string, options: { printUrl?: boolean }): void {
  if (options.printUrl === true) {
    process.stdout.write(`Open this URL to sign in:\n${url}\n`)
    return
  }
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  const child = spawn(command, args, { stdio: "ignore", detached: true })
  child.on("error", () => {
    process.stdout.write(`Could not open a browser. Open this URL by hand:\n${url}\n`)
  })
  child.unref()
}
