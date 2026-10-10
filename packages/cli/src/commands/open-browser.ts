import { spawn } from "node:child_process"

/**
 * Opens the system browser.
 *
 * The opener is chosen by the OS rather than by the shell the user happens to have, and the URL is
 * passed as one argument so it is never interpreted as a shell command. A caller that cannot open a
 * browser gets the URL printed, because a URL that silently fails to open is a dead end.
 */
export function openBrowser(url: string, print: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  const child = spawn(command, args, { stdio: "ignore", detached: true })
  child.on("error", () => {
    print(`Could not open a browser. Open this URL by hand:\n${url}`)
  })
  child.unref()
}
