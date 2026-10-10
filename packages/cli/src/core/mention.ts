/** The mention span the picker is currently filtering, in coordinates the composer holds. */
export interface MentionSpan {
  /** Index of the `@` that opens the mention. */
  start: number
  /** The text between the `@` and the caret. */
  query: string
}

/**
 * Rows the picker shows at once. The composer sits above the hint row, and a list taller than the
 * space above it paints over the transcript, so this is the height the layout can afford rather than
 * a slice of the scan.
 */
export const MENTION_LIMIT = 9

/**
 * The mention the caret is inside, or `null` when it is inside none.
 *
 * The `@` only opens a picker at the start of the text or after whitespace. Without that rule every
 * typed address opens a picker the user did not ask for, because `user@example.com` is otherwise an
 * `@` followed by a query.
 */
export function activeMention(value: string, caret: number): MentionSpan | null {
  if (caret > value.length) return null
  for (let index = caret - 1; index >= 0; index -= 1) {
    const character = value[index]
    if (character === undefined) return null
    if (character === "@") {
      const before = value[index - 1]
      if (index === 0 || before === undefined || /\s/.test(before)) return { start: index, query: value.slice(index + 1, caret) }
      return null
    }
    // A whitespace boundary ends the mention, so a caret that has moved past a space is in no
    // mention at all even when an earlier `@` exists.
    if (/\s/.test(character)) return null
  }
  return null
}

/**
 * The composer text with the `@query` span replaced by `insertion`, and the caret after it.
 *
 * The caret is returned rather than left to the caller because the `value` setter on the input
 * moves it to the end of the new text, so the one piece of state the setter cannot know is the one
 * the caller has to restore.
 */
export function replaceMention(value: string, mention: MentionSpan, insertion: string): { value: string; caret: number } {
  const head = value.slice(0, mention.start)
  const tail = value.slice(mention.start + 1 + mention.query.length)
  const caret = head.length + insertion.length + 1
  return { value: `${head}${insertion} ${tail}`, caret }
}

/**
 * The `limit` paths that best answer `query`, most relevant first.
 *
 * Ranking is a basename match, then anything else, then alphabetical. `DialogSearchList` already
 * filters by substring, and two tiers are predictable where a fuzzy score is not.
 */
export function rankMatches(paths: readonly string[], query: string, limit: number): string[] {
  const needle = query.trim().toLowerCase()
  const scored = paths
    .filter((path) => path.toLowerCase().includes(needle))
    .map((path) => ({ path, basenameMatch: basename(path).toLowerCase().includes(needle) ? 0 : 1 }))
  scored.sort((left, right) => left.basenameMatch - right.basenameMatch || comparePaths(left.path, right.path))
  return scored.slice(0, limit).map((entry) => entry.path)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function comparePaths(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
