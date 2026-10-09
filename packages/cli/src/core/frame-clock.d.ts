/**
 * The frame clock the terminal client runs on.
 *
 * `CliRenderer`'s constructor installs these two globals with its own implementations, and it drains the
 * registered callbacks once per rendered frame. They are declared here because `bun run typecheck` at
 * the repository root compiles one program whose `lib` is `ESNext` only, so the DOM library that would
 * otherwise declare them never sees this package. The per-package `packages/cli/tsconfig.json` does
 * list `DOM`, which is why `bun run typecheck` from inside `packages/cli` appears to work without this.
 */
declare function requestAnimationFrame(callback: (deltaTime: number) => void): number
declare function cancelAnimationFrame(handle: number): void
