/**
 * The frame clock the terminal client runs on.
 *
 * `CliRenderer`'s constructor installs these two globals with its own implementations, and it drains
 * the registered callbacks once per rendered frame. Nothing else here declares them: `@opentui/core`
 * types its own methods but not the globals it replaces, and this package compiles without the DOM
 * lib, so the declaration lives with the renderer code that installs it.
 */
declare function requestAnimationFrame(callback: (deltaTime: number) => void): number
declare function cancelAnimationFrame(handle: number): void
