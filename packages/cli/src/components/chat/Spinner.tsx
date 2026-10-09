import { useEffect, useState } from "react"
import type { Theme } from "../../styles/theme.js"

const GLYPHS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * Milliseconds between glyphs. The renderer aims for 30 frames a second, so advancing on every frame
 * would spend the whole frame budget redrawing one character. It also lets a frame go by without
 * changing a cell, which is what lets the headless harness reach visual idle.
 */
const FRAME_INTERVAL_MS = 100

export interface SpinnerProps {
  theme: Theme
  label: string
}

/**
 * The spinner runs on the renderer's own frame clock, because the gap before the first token is the
 * one moment a chat terminal has nothing at all to show. The frame request is cancelled on unmount,
 * so a spinner that leaves the tree stops asking for frames.
 */
export function Spinner({ theme, label }: SpinnerProps) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    let handle = 0
    let last = performance.now()
    const advance = () => {
      const now = performance.now()
      if (now - last >= FRAME_INTERVAL_MS) {
        last = now
        setPhase((current) => (current + 1) % GLYPHS.length)
      }
      handle = requestAnimationFrame(advance)
    }
    handle = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(handle)
  }, [])

  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.accent}>{GLYPHS[phase]}</text>
      <text fg={theme.dim}>{label}</text>
    </box>
  )
}
