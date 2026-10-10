import { NIGHTCODE_HOME_ENV } from "@nightcode/shared"
import { login } from "../auth/flow.js"
import { openTokenStore } from "../auth/token-storage.js"
import { openBrowser } from "./open-browser.js"

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
    openBrowser: (url) => {
      if (options.printUrl === true) print(`Open this URL to sign in:\n${url}`)
      else openBrowser(url, print)
    },
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
