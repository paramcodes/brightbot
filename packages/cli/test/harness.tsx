import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import type { ReactNode } from "react"

export const TEST_VIEWPORT = { width: 100, height: 30 } as const

export type TuiHarness = TestRendererSetup

/**
 * Renders a TUI tree headlessly at a fixed size with the kitty keyboard protocol on, which is what
 * makes `escape`, `return`, and `ctrl+c` arrive as clean single events instead of ambiguous bytes.
 */
export async function renderTui(node: ReactNode, viewport: { width: number; height: number } = TEST_VIEWPORT): Promise<TuiHarness> {
  const setup = await testRender(node, {
    width: viewport.width,
    height: viewport.height,
    kittyKeyboard: true,
    // The app owns ctrl+c through the responder chain; the renderer must not tear the screen down first.
    exitOnCtrlC: false,
  })
  await settle(setup)
  return setup
}

/**
 * Waits for React work and the native renderer to produce a stable frame.
 *
 * A keypress updates React state on a scheduled task, and the renderer's own `flush()` does not yield
 * the event loop, so the macro-task tick comes first. Without it a frame captured straight after a
 * keypress shows the previous render.
 *
 * The second tick matters more than it looks: pushing a responder layer happens in a passive effect,
 * which React runs after the render commits. One tick can land before that effect, so a key sent in the
 * same tick is dispatched to the layer that is still being registered. Two ticks make the register-then-
 * dispatch order deterministic, which is what stops the command-menu tests from racing.
 */
export async function settle(setup: TuiHarness): Promise<void> {
  await tick()
  await setup.flush()
  await tick()
  await setup.flush()
  await setup.waitForVisualIdle({ maxFrames: 10 })
}

/**
 * Settles repeatedly until `predicate` holds, or throws once the budget is spent.
 *
 * `settle()`'s `waitForVisualIdle` returns while a `<markdown>` renderable is still building its block
 * tree, so a frame captured straight after a render can be blank for a finalized body. Polling is the
 * only way to wait for the renderable rather than for React.
 *
 * The timeout error carries the last frame it saw, because a failure here is always "the text was not
 * on screen" and the frame is the only record of what was.
 */
export async function untilSettled(setup: TuiHarness, predicate: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  let last = ""
  while (Date.now() < deadline) {
    await settle(setup)
    last = frame(setup)
    if (predicate()) return
    await tick()
  }
  throw new Error(`untilSettled timed out after ${budgetMs}ms. Last frame:\n${last}`)
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function frame(setup: TuiHarness): string {
  return setup.captureCharFrame()
}

/**
 * Sends control keys. `pressKeys` sends legacy byte sequences, which the kitty-aware parser drops for
 * bare ESC, so every control key goes through the kitty-encoding helpers instead.
 */
export async function press(setup: TuiHarness, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    const action = CONTROL_KEYS[key.toLowerCase()]
    if (action) action(setup.mockInput)
    else setup.mockInput.pressKey(key)
  }
  await settle(setup)
}

export async function type(setup: TuiHarness, text: string): Promise<void> {
  await setup.mockInput.typeText(text)
  await settle(setup)
}

export function pressCtrlC(setup: TuiHarness): void {
  setup.mockInput.pressCtrlC()
}

type MockKeys = TuiHarness["mockInput"]

const CONTROL_KEYS: Record<string, (keys: MockKeys) => void> = {
  escape: (keys) => keys.pressEscape(),
  esc: (keys) => keys.pressEscape(),
  return: (keys) => keys.pressEnter(),
  enter: (keys) => keys.pressEnter(),
  tab: (keys) => keys.pressTab(),
  backspace: (keys) => keys.pressBackspace(),
  up: (keys) => keys.pressArrow("up"),
  down: (keys) => keys.pressArrow("down"),
  left: (keys) => keys.pressArrow("left"),
  right: (keys) => keys.pressArrow("right"),
  home: (keys) => keys.pressKey("HOME"),
  end: (keys) => keys.pressKey("END"),
  delete: (keys) => keys.pressKey("DELETE"),
}
