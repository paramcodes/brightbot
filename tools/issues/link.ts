/**
 * Links each phase epic to its commit sub-issues. Idempotent: an existing link is a no-op.
 * Issue numbers come from `tools/plan.json` order: 9 epics then their commits, starting at #3.
 */
const REPO = process.env.GITHUB_REPO ?? "paramcodes/brightbot"
const EPIC_NUMBERS = [3, 9, 14, 19, 24, 29, 34, 39, 45]
const EPIC_PHASE = new Map<number, number>(EPIC_NUMBERS.map((number, index) => [number, index + 1]))

interface IssueInfo {
  id: string
  title: string
  subIssues: number[]
}

const issues = new Map<number, IssueInfo>()
for (const number of EPIC_NUMBERS) {
  const json = JSON.parse(
    Bun.spawnSync(["gh", "api", `repos/${REPO}/issues/${number}`], { stdout: "pipe", stderr: "pipe" }).stdout.toString(),
  )
  issues.set(number, {
    id: json.node_id,
    title: json.title,
    subIssues: (json.sub_issues ?? []).map((sub: { number: number }) => sub.number),
  })
}

const commitIssues = new Map<number, string>()
for (let number = 4; number <= 49; number += 1) {
  if (EPIC_NUMBERS.includes(number)) continue
  const json = JSON.parse(
    Bun.spawnSync(["gh", "api", `repos/${REPO}/issues/${number}`], { stdout: "pipe", stderr: "pipe" }).stdout.toString(),
  )
  const phase = /^(\d+)\.\d+ /.exec(json.title as string)?.[1]
  if (phase) commitIssues.set(number, phase)
}

let linked = 0
for (const [epicNumber, epic] of issues) {
  const phase = String(EPIC_PHASE.get(epicNumber))
  for (const [childNumber, childPhase] of commitIssues) {
    if (childPhase !== phase || epic.subIssues.includes(childNumber)) continue
    const child = issues.get(childNumber) ?? loadIssue(childNumber)
    const query = `mutation { addSubIssue(input: {issueId: "${epic.id}", subIssueId: "${child.id}"}) { issue { number } } }`
    const result = Bun.spawnSync(["gh", "api", "graphql", "--method", "POST", "-f", `query=${query}`], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) console.log(`FAIL #${childNumber}: ${result.stderr.toString().slice(0, 200)}`)
    else linked += 1
  }
}
console.log(`linked ${linked} sub-issues across ${issues.size} epics`)

function loadIssue(number: number): IssueInfo {
  const json = JSON.parse(
    Bun.spawnSync(["gh", "api", `repos/${REPO}/issues/${number}`], { stdout: "pipe", stderr: "pipe" }).stdout.toString(),
  )
  const info: IssueInfo = {
    id: json.node_id,
    title: json.title,
    subIssues: (json.sub_issues ?? []).map((sub: { number: number }) => sub.number),
  }
  issues.set(number, info)
  return info
}
