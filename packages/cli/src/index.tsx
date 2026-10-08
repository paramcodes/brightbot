#!/usr/bin/env bun
import { createRoot } from "@opentui/react"
import { App } from "./app.js"
import { createAppRenderer } from "./core/renderer.js"

const renderer = await createAppRenderer()
createRoot(renderer).render(<App />)
