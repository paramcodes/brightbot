# Night Code

An open-source terminal coding agent. Night Code runs in your terminal, reads and edits the code in
your working directory, and streams model output token by token. The backend is a stateless relay;
execution authority stays on your machine.

<!-- FEATURE-MAP:START -->

| Phase | Focus | Commits | Status | Issue |
| --- | --- | --- | --- | --- |
| 1. Workspace Scaffolding & Core TUI Foundation | Bun monorepo, OpenTUI React shell, layout primitives, responder chain, toasts. | 1.1, 1.2, 1.3, 1.4, 1.5 | shipped | #3 |
| 2. Navigation, Modals & Persistent Theming | Persistent config, themes, reusable dialog list, root command menu, memory router. | 2.1, 2.2, 2.3, 2.4 | shipped | #9 |
| 3. Backend Infrastructure, Database & Observability | Hono server, Prisma schema, RPC client types, Sentry middleware, file-backed default store. | 3.1, 3.2, 3.3, 3.4 | shipped | #14 |
| 4. Real-Time AI Chat Engine & Interruption Flow | SSE streaming endpoint, message rendering, optimistic transitions, abort via Esc. | 4.1, 4.2, 4.3, 4.4 | shipped | #19 |
| 5. Agent Modes, Session Resumption & File Mentions | Plan vs Build mode, model picker, session history, @ file mentions. | 5.1, 5.2, 5.3, 5.4 | shipped | #24 |
| 6. Browser-to-CLI OAuth & User Security | PKCE, loopback server, browser login, restricted credential store, server-side auth. | 6.1, 6.2, 6.3, 6.4 | shipped | #29 |
| 7. SaaS Monetization, Credit Metering & Rate Limiting | Credit ledger, gating middleware, token ingestion, `/usage` and `/upgrade` dialogs. | 7.1, 7.2, 7.3, 7.4 | shipped | #34 |
| 8. Client-Side Tool Execution Engine | Shared tool schemas, local executors, client-side tool loop, confirmation, grouped rendering. | 8.1, 8.2, 8.3, 8.4, 8.5 | planned | #39 |
| 9. Distribution, Packaging & Production Polish | Binary entry point, container deploy config, AI review config, clean exit traps, live demo. | 9.1, 9.2, 9.3, 9.4 | planned | #45 |

<!-- FEATURE-MAP:END -->

## Status

The build follows `night_code_implementation_plan.md` in nine phases, one pull request per phase.
`docs/feature-map.md` holds the generated map. `.opencode/skills/verify-nightcode/` holds the verification skill: launch, drive, evidence, and a feature map.

