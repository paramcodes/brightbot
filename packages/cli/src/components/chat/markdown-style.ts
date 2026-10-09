import { SyntaxStyle } from "@opentui/core"
import type { Theme } from "../../styles/theme.js"

/**
 * The one place a theme becomes markdown scopes.
 *
 * `MarkdownRenderable` resolves these names itself, so a change of theme reaches the rendered answer
 * instead of leaving dracula hex codes in the render path.
 *
 * Two limits measured against the terminal at 0.5.17. `markup.heading` reaches table header cells
 * only, because a `# heading` block is rendered as a markdown code block with no tree-sitter client
 * and so takes the body color. A fenced code block takes the body color for the same reason, and
 * highlighting one needs a `treeSitterClient` this repo does not configure.
 */
export function syntaxStyle(theme: Theme): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.fg },
    "markup.heading": { fg: theme.accent, bold: true },
    "markup.strong": { fg: theme.fg, bold: true },
    "markup.italic": { fg: theme.muted, italic: true },
    "markup.raw": { fg: theme.accentAlt },
    "markup.link": { fg: theme.info },
    "markup.link.label": { fg: theme.info },
    "markup.link.url": { fg: theme.dim },
    "markup.quote": { fg: theme.muted },
    // Blockquote, rule, and table borders read this scope, and fall back to a fixed hex without it.
    conceal: { fg: theme.border },
  })
}
