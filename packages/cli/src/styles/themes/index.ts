import type { Theme } from "../theme.js"
import { catppuccin } from "./catppuccin.js"
import { dracula } from "./dracula.js"
import { monokai } from "./monokai.js"
import { nightfox } from "./nightfox.js"

export const THEMES = {
  dracula,
  nightfox,
  catppuccin,
  monokai,
} as const satisfies Record<string, Theme>

export type ThemeName = keyof typeof THEMES

export const THEME_NAMES = Object.keys(THEMES) as readonly ThemeName[]

export const DEFAULT_THEME: ThemeName = "dracula"

export function isThemeName(value: string): value is ThemeName {
  return Object.hasOwn(THEMES, value)
}
