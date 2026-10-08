/**
 * Creates the phase epics and per-commit sub-issues from tools/plan.json.
 * Idempotent: an issue whose title already exists is reused, not duplicated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

type Plan = typeof import("../plan.json")
const plan: Plan = JSON.parse(readFileSync(new URL("../plan.json", import.meta.url), "utf8"))

const REPO = process.env.GITHUB_REPO ?? "paramcodes/brightbot"

async function gh<T>(args: string[], input?: string): Promise<T> {
  const proc = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${err.slice(0, 400)}`)
  return (out ? JSON.parse(out) : {}) as T
}

const LABELS = ["platform", "cli", "server", "shared", "tooling", "feature", "chore", "phase", "commit", "demo"]
const EXISTING_LABELS = new Set(
  (await gh<{ name: string }[]>(["label", "list", "--repo", REPO, "--limit", "200", "--json", "name"])).map((l) => l.name),
)
for (const name of [...LABELS, ...plan.phases.map((p) => `phase-${p.id}`)]) {
  if (!EXISTING_LABELS.has(name)) {
    await gh(["label", "create", name, "--repo", REPO, "--description", "nightcode plan tracking", "--color", "1f6feb"])
    console.log(`label + ${name}`)
  }
}

const milestoneRaw = Bun.spawnSync(["gh", "api", `repos/${REPO}/milestones`, "--method", "GET"], { stdout: "pipe", stderr: "pipe" })
const milestones: { title: string; number: number }[] = JSON.parse(new TextDecoder().decode(milestoneRaw.stdout) || "[]")
for (const phase of plan.phases) {
  const title = `Phase ${phase.id}: ${phase.title}`
  if (milestones.some((m) => m.title === title)) continue
  await gh(["api", `repos/${REPO}/milestones`, "--method", "POST", "-f", `title=${title}`, "-f", `description=${phase.focus}`])
  console.log(`milestone + ${title}`)
}

const existingIssues = await gh<{ number: number; title: string }[]>([
  "issue",
  "list",
  "--repo",
  REPO,
  "--state",
  "all",
  "--limit",
  "300",
  "--json",
  "number,title",
])
const byTitle = new Map(existingIssues.map((i) => [i.title, i]))

function issueBody(
  kind: "epic" | "commit",
  phase: (typeof plan.phases)[number],
  c?: (typeof plan.phases)[number]["commits"][number],
): string {
  const lines: string[] = []
  lines.push(`_Part of the Night Code build plan (\`tools/plan.json\`). Phase ${phase.id} of 9._\n`)
  if (kind === "epic") {
    lines.push(`## What\n${phase.summary.what}\n`)
    lines.push(`## Why\n${phase.summary.why}\n`)
    lines.push(`## How it helps\n${phase.summary.how}\n`)
    lines.push(`## Stack\n${phase.stack}\n`)
    lines.push(`## Commits\n`)
    for (const commit of phase.commits) lines.push(`- [ ] ${commit.id} ${commit.title}`)
  } else if (c) {
    lines.push(`## What\n${c.what}\n`)
    lines.push(`## Why\n${c.why}\n`)
    lines.push(`## How it helps\n${c.how}\n`)
    lines.push(
      `## Files\n${c.files
        .split(", ")
        .map((f) => `\`${f}\``)
        .join(" · ")}\n`,
    )
    lines.push(`**Parent:** ${phase.title}\n`)
  }
  return lines.join("\n")
}

async function ghText(args: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${err.slice(0, 400)}`)
  return out.trim()
}

async function ensureIssue(title: string, body: string): Promise<number> {
  const hit = byTitle.get(title)
  if (hit) return hit.number
  const url = await ghText(["issue", "create", "--repo", REPO, "--title", title, "--body", body], body)
  const number = Number(url.split("/").pop())
  byTitle.set(title, { number, title })
  console.log(`issue + ${number} ${title}`)
  return number
}

const lines = ["| Phase | Commit | Issue | Milestone |", "| --- | --- | --- | --- |"]
for (const phase of plan.phases) {
  const epicTitle = `Phase ${phase.id}: ${phase.title}`
  const epic = await ensureIssue(epicTitle, issueBody("epic", phase))
  await ghText(["issue", "edit", String(epic), "--repo", REPO, "--add-label", `phase-${phase.id},phase,platform`, "--milestone", epicTitle])
  lines.push(`| ${phase.id} | epic | #${epic} | ${epicTitle} |`)
  for (const c of phase.commits) {
    const title = `${c.id} ${c.title}`
    const number = await ensureIssue(title, issueBody("commit", phase, c))
    await ghText(["issue", "edit", String(number), "--repo", REPO, "--add-label", "commit", "--milestone", epicTitle])
    await gh([
      "api",
      "graphql",
      "--method",
      "POST",
      "-f",
      `query=mutation { addSubIssue(input: {issueId: "${epic}", subIssueId: "${number}"}) { issue { number } } }`,
    ]).catch(() => console.log(`sub-issue link skipped for #${number}`))
    lines.push(`| | ${c.id} | #${number} | ${epicTitle} |`)
  }
  console.log(`phase ${phase.id} -> #${epic}`)
}

const store = new URL("../orchestrate/nightcode/", import.meta.url)
if (!existsSync(store)) mkdirSync(store, { recursive: true })
writeFileSync(
  new URL("overview.md", store),
  `# Night Code — PR and issue DB\n\nAppend-only. Generated by \`tools/issues/create.ts\`.\n\n${lines.join("\n")}\n\n## PRs\n\n`,
)
console.log(`\n${lines.length - 2} issues linked`)
