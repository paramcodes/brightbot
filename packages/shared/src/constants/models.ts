/**
 * The models the user can pick, and what they cost.
 *
 * Closed on purpose: every id is one the Phase 4 provider adapters can actually call, which is
 * `claude-sonnet-4-5` and `gpt-5` and their siblings, rather than the older list the plan carried.
 * A mode is chosen here or nowhere, so a model outside this table is unreachable by construction.
 *
 * The prices are operator-owned data, not derived. Both columns are the published list rate in USD
 * per million tokens, read from the Anthropic pricing page
 * (https://platform.claude.com/docs/en/about-claude/pricing) and the OpenAI pricing page
 * (https://platform.openai.com/docs/pricing) on 2026-10-10, at the standard tier. Cache writes,
 * cache hits, batch rates, and the long-context tiers are deliberately not modelled, so the number
 * the picker shows is the one a turn billed at the base rate costs. Re-read both pages before
 * trusting a row.
 */
export interface ModelOption {
  id: string
  label: string
  provider: string
  inputPerMillion: number
  outputPerMillion: number
}

export const MODELS: readonly ModelOption[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", inputPerMillion: 1, outputPerMillion: 5 },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic", inputPerMillion: 3, outputPerMillion: 15 },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "anthropic", inputPerMillion: 5, outputPerMillion: 25 },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", inputPerMillion: 0.25, outputPerMillion: 2 },
  { id: "gpt-5", label: "GPT-5", provider: "openai", inputPerMillion: 1.25, outputPerMillion: 10 },
  { id: "gpt-5-pro", label: "GPT-5 pro", provider: "openai", inputPerMillion: 15, outputPerMillion: 120 },
]

/** The ids alone, for a caller that needs to recognise a chosen model without mapping the table. */
export const MODEL_IDS: readonly string[] = MODELS.map((model) => model.id)
