# Night Code: Multi-Phase Engineering Implementation Plan

This implementation plan breaks down the construction of **Night Code**—a full-featured, open-source terminal coding agent alternative to Claude Code and OpenCode—into 9 sequential phases and atomic, focused git commits.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        packages/cli (Bun / Open TUI)                   │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │  React Terminal UI    │  │ Responder Chain │  │ Local Tool Engine│ │
│  │ (Header, Input, Views)│  │ (Keys, Modals)  │  │ (fs, glob, bash) │ │
│  └───────────┬───────────┘  └─────────────────┘  └────────┬─────────┘ │
│              │                                            │           │
│              ▼                                            │           │
│        Vercel AI SDK Client (useChat + onToolCall Loop) ◄─┘           │
└───────────────────────┬────────────────────────────────────────────────┘
                        │ HTTP / SSE / Hono RPC
                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       packages/server (Hono / Bun)                     │
│                                                                        │
│  ┌───────────────────┐  ┌────────────────────┐  ┌───────────────────┐ │
│  │ Auth Middleware   │  │ Credit Metering    │  │ LLM Stream Relay  │ │
│  │ (Clerk JWT)       │  │ (Polar SDK)        │  │ (Vercel AI SDK)   │ │
│  └───────────────────┘  └────────────────────┘  └───────────────────┘ │
│           │                                                │          │
│           ▼                                                ▼          │
│  PostgreSQL (Neon via Prisma)                    Anthropic / OpenAI   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Workspace Scaffolding & Core TUI Foundation

### Commit 1.1: Initialize Bun workspace and monorepo structure
* **Files Changed:**
  * `package.json`
  * `bunfig.toml`
  * `packages/cli/package.json`
  * `packages/shared/package.json`
  * `.gitignore`
* **What:** Configures Bun workspaces with `packages/cli` and `packages/shared`. Sets up TypeScript base configs (`tsconfig.json` at root and per-package) with strict mode and path aliasing.
* **Why:** Monorepos allow sharing TypeScript contracts, Zod schemas, and RPC types between the terminal client and the backend server without duplicate types or publishing private packages.
* **How it helps us:** Establishes the foundational dependency graph and build pipeline, enabling instant imports across packages with zero build latency under Bun.

---

### Commit 1.2: Scaffold Open TUI React application shell
* **Files Changed:**
  * `packages/cli/src/index.tsx`
  * `packages/cli/src/app.tsx`
  * `packages/cli/tsconfig.json`
* **What:** Bootstraps the Open TUI React terminal renderer with a simple terminal root canvas and a placeholder greeting component.
* **Why:** Open TUI allows writing terminal interfaces using standard React primitives (`useState`, `useEffect`, JSX flex layouts) while rendering to terminal escape sequences instead of the browser DOM.
* **How it helps us:** Confirms the terminal rendering pipeline works on raw TTY streams and gives us a reactive component hierarchy for the rest of the UI.

---

### Commit 1.3: Create layout primitives: Header, ASCII banner, and InputBar
* **Files Changed:**
  * `packages/cli/src/components/layout/Header.tsx`
  * `packages/cli/src/components/layout/Banner.tsx`
  * `packages/cli/src/components/input/InputBar.tsx`
  * `packages/cli/src/styles/box.ts`
* **What:** Implements styled ASCII art branding, a responsive top header displaying status indicators, and an interactive terminal input field supporting text entry, cursor movement, and backspacing.
* **Why:** The terminal screen has strict rectangular column/row limits. We need declarative, reusable components that respect dynamic terminal resize events.
* **How it helps us:** Delivers the primary interface elements where users view agent status and type prompts.

---

### Commit 1.4: Implement terminal responder chain for event management
* **Files Changed:**
  * `packages/cli/src/core/responder/ResponderContext.tsx`
  * `packages/cli/src/core/responder/useResponder.ts`
  * `packages/cli/src/core/responder/types.ts`
* **What:** Builds a stack-based responder chain (`pushLayer`, `popLayer`, `isTopLayer`) to route stdin keyboard strokes to the currently active UI layer.
* **Why:** Terminal environments have no native DOM bubbling or event propagation. Without a centralized responder chain, pressing `Escape` or `Ctrl+C` inside an open modal or input field would either crash the process or trigger multiple conflicting listeners.
* **How it helps us:** Enables complex floating modals, dialog overlays, and interrupt signals that cleanly trap keypresses and unwind in reverse order.

---

### Commit 1.5: Build Toast notification subsystem
* **Files Changed:**
  * `packages/cli/src/components/toast/ToastProvider.tsx`
  * `packages/cli/src/components/toast/useToast.ts`
  * `packages/cli/src/components/toast/ToastItem.tsx`
* **What:** Adds a floating toast manager that renders dismissible notification banners (success, error, warning, info) with configurable auto-dismiss timeouts.
* **Why:** Terminal commands need non-blocking visual feedback for background actions (e.g., config changes, network reconnection, copy actions) without cluttering the main conversation stream.
* **How it helps us:** Provides an async feedback channel throughout the CLI for background operations.

---

## Phase 2: Navigation, Modals & Persistent Theming

### Commit 2.1: Add persistent configuration & theme engine
* **Files Changed:**
  * `packages/cli/src/lib/config.ts`
  * `packages/cli/src/styles/themes/dracula.ts`
  * `packages/cli/src/styles/themes/nightfox.ts`
  * `packages/cli/src/styles/themes/index.ts`
  * `packages/cli/src/context/ThemeContext.tsx`
* **What:** Reads and writes user settings to `~/.nightcode/preferences.json`. Exposes a `ThemeProvider` supporting multiple color palettes (Dracula, Nightfox, Catppuccin, Monokai).
* **Why:** Users need personalized visual configurations that survive process restarts.
* **How it helps us:** Eliminates hardcoded ANSI color codes across components and establishes disk persistence for user settings.

---

### Commit 2.2: Implement generic DialogSearchList component
* **Files Changed:**
  * `packages/cli/src/components/dialogs/DialogSearchList.tsx`
  * `packages/cli/src/components/dialogs/DialogBackdrop.tsx`
* **What:** Creates a reusable modal overlay containing a filterable search input, a scrollable list of items, arrow-key navigation, and selection callbacks.
* **Why:** Multiple CLI features (command menu, session picker, file mentions, model selector) share identical list-filtering and selection behavior.
* **How it helps us:** Prevents duplicate keyboard navigation logic across dialogs and ensures consistent UX across all modal views.

---

### Commit 2.3: Build root Command Menu (`/` trigger)
* **Files Changed:**
  * `packages/cli/src/components/command-menu/CommandMenu.tsx`
  * `packages/cli/src/components/command-menu/commands.ts`
  * `packages/cli/src/app.tsx`
* **What:** Adds a global listener that opens the command palette when `/` is typed into an empty input bar, listing commands like `/clear`, `/sessions`, `/models`, `/agents`, `/usage`, and `/exit`.
* **Why:** Developers expect quick slash-command shortcuts to control the agent without needing mouse interactions or leaving the terminal.
* **How it helps us:** Serves as the central command hub for invoking all CLI features and switching modes.

---

### Commit 2.4: Integrate React Router Memory Router & Session Shell
* **Files Changed:**
  * `packages/cli/src/router/routes.tsx`
  * `packages/cli/src/views/HomeView.tsx`
  * `packages/cli/src/views/SessionView.tsx`
  * `packages/cli/src/components/layout/RootLayout.tsx`
* **What:** Configures `createMemoryRouter` from React Router inside the TUI, creating distinct routes for the landing screen and active session chat view.
* **Why:** Terminal UIs need clear separation between idle/welcome screens and active conversation views without manual boolean state flags in the root component.
* **How it helps us:** Decouples view logic, isolates screen-specific responders, and enables deep-linking into specific past sessions.

---

## Phase 3: Backend Infrastructure, Database & Observability

### Commit 3.1: Initialize packages/server with Hono and Bun
* **Files Changed:**
  * `packages/server/package.json`
  * `packages/server/src/index.ts`
  * `packages/server/src/app.ts`
  * `packages/server/tsconfig.json`
* **What:** Scaffolds the HTTP backend using the Hono web framework running on Bun, configuring CORS, JSON body parsing, and a health check endpoint.
* **Why:** Hono is ultra-lightweight, runs natively on Bun, and offers end-to-end type safety through Hono RPC.
* **How it helps us:** Establishes the backend API server that will orchestrate LLM calls, handle authentication, and track usage.

---

### Commit 3.2: Configure Prisma ORM with Neon PostgreSQL
* **Files Changed:**
  * `packages/server/prisma/schema.prisma`
  * `packages/server/src/lib/db.ts`
  * `packages/server/.env.example`
* **What:** Defines the database schema for `User`, `Session`, `Message`, and `TokenUsage`. Connects to a serverless Neon PostgreSQL instance via Prisma Client.
* **Why:** Cloud persistence allows users to retain chat histories, context windows, and credit usage across machines and deployments.
* **How it helps us:** Provides a scalable relational data store for sessions and billing records.

---

### Commit 3.3: Set up Hono RPC client in packages/cli
* **Files Changed:**
  * `packages/shared/src/types/api.ts`
  * `packages/cli/src/lib/api-client.ts`
  * `packages/server/src/routes/sessions.ts`
* **What:** Exports Hono API route types from `packages/server` and instantiates `hc<AppType>` inside `packages/cli`.
* **Why:** Hono RPC provides full TypeScript auto-completion and compile-time validation for URL parameters, query strings, and request/response payloads without code generation.
* **How it helps us:** Catch API contract mismatches immediately during compile time.

---

### Commit 3.4: Integrate Sentry error monitoring and observability
* **Files Changed:**
  * `packages/server/src/lib/sentry.ts`
  * `packages/server/src/middleware/error-handler.ts`
  * `packages/server/src/app.ts`
* **What:** Adds Sentry middleware for Hono to capture unhandled server exceptions, database connection errors, and downstream AI API failures.
* **Why:** Distributed agents encounter varied external failure modes (rate limits, upstream LLM outages, malformed client streams) that require real-time telemetry in production.
* **How it helps us:** Provides production-grade error reporting and performance tracking before going live on Railway.

---

## Phase 4: Real-Time AI Chat Engine & Interruption Flow

### Commit 4.1: Build SSE streaming endpoint with Vercel AI SDK on Hono
* **Files Changed:**
  * `packages/server/src/routes/chat.ts`
  * `packages/server/src/lib/ai.ts`
  * `packages/shared/src/schemas/chat.ts`
* **What:** Implements `POST /api/chat` using Hono's `streamSSE` and Vercel AI SDK's `streamText`. Integrates Anthropic (`anthropic('claude-3-5-sonnet')`) and OpenAI providers.
* **Why:** Large language model responses take seconds to complete; streaming Server-Sent Events guarantees immediate time-to-first-token in the terminal.
* **How it helps us:** Provides token-by-token streaming back to the terminal client.

---

### Commit 4.2: Build message rendering components (User, Bot, Spinner)
* **Files Changed:**
  * `packages/cli/src/components/chat/MessageList.tsx`
  * `packages/cli/src/components/chat/UserMessage.tsx`
  * `packages/cli/src/components/chat/BotMessage.tsx`
  * `packages/cli/src/components/chat/ThinkingBlock.tsx`
* **What:** Renders formatted terminal message blocks with markdown support, distinctive borders, sender avatars, and expandable reasoning/thinking token bubbles.
* **Why:** Raw terminal text lacks visual hierarchy. Proper message bubbles and distinct thinking blocks make long agent thoughts and tool outputs readable.
* **How it helps us:** Delivers clean visual presentation for conversational responses and chain-of-thought traces.

---

### Commit 4.3: Implement optimistic screen transition on prompt submission
* **Files Changed:**
  * `packages/cli/src/views/HomeView.tsx`
  * `packages/cli/src/views/SessionView.tsx`
  * `packages/cli/src/hooks/useChatSession.ts`
* **What:** When a user hits `Enter` on the Home screen, immediately creates an in-memory session stub, navigates to `SessionView`, renders the user prompt, and fires the server creation request asynchronously.
* **Why:** Waiting for a server round-trip before updating the terminal makes the CLI feel sluggish.
* **How it helps us:** Delivers instant, zero-latency feedback on prompt submission.

---

### Commit 4.4: Implement client-side generation abort and interruption via `Esc`
* **Files Changed:**
  * `packages/cli/src/hooks/useChatStream.ts`
  * `packages/cli/src/components/input/InputBar.tsx`
  * `packages/server/src/routes/chat.ts`
* **What:** Uses `AbortController` linked to the top-level responder chain. When the user presses `Esc` during generation, the CLI aborts the HTTP SSE stream and instructs the server to persist the partial response with status `interrupted`.
* **Why:** When an agent starts generating the wrong code or enters an infinite loop, users must be able to cancel immediately without killing the entire CLI process.
* **How it helps us:** Gives users total control over token consumption and execution flow.

---

## Phase 5: Agent Modes, Session Resumption & File Mentions

### Commit 5.1: Create Plan Mode vs Build Mode prompt configurations
* **Files Changed:**
  * `packages/shared/src/prompts/plan-mode.ts`
  * `packages/shared/src/prompts/build-mode.ts`
  * `packages/cli/src/context/AgentModeContext.tsx`
  * `packages/cli/src/components/layout/StatusBar.tsx`
* **What:** Implements an Agent Mode toggle (`Tab` key or `/agents` command) between **Plan Mode** (read-only, architectural analysis, no file modification) and **Build Mode** (full tool access to edit, create, and run bash commands). Updates the prompt sent to the LLM.
* **Why:** Users often want the model to analyze architecture and propose plans safely before authorizing destructive file edits.
* **How it helps us:** Prevents unintended code edits during discovery and design discussions.

---

### Commit 5.2: Build dynamic model selection dialog (`/models`)
* **Files Changed:**
  * `packages/cli/src/components/dialogs/ModelSelectDialog.tsx`
  * `packages/shared/src/constants/models.ts`
  * `packages/cli/src/context/ChatConfigContext.tsx`
* **What:** Adds a modal listing supported models (Claude 3.5 Sonnet, Claude 3 Opus, GPT-4o, Gemini 1.5 Pro) with pricing per million tokens and speeds. Updates session metadata.
* **Why:** Different tasks require different trade-offs between speed, cost, and reasoning power.
* **How it helps us:** Allows users to switch models mid-workflow depending on task complexity.

---

### Commit 5.3: Build Session History resume dialog (`/sessions`)
* **Files Changed:**
  * `packages/cli/src/components/dialogs/SessionListDialog.tsx`
  * `packages/cli/src/hooks/useSessionHistory.ts`
  * `packages/server/src/routes/sessions.ts`
* **What:** Fetches recent sessions from Neon PostgreSQL, formats timestamps with `date-fns`, displays title snippets in a fuzzy-search dialog, and hydrates the chosen session into the active view upon selection.
* **Why:** Coding tasks span days; developers must be able to resume context from previous days without re-explaining the project.
* **How it helps us:** Eliminates lost context and allows seamless continuation of previous work.

---

### Commit 5.4: Implement `@` File Mention autocomplete system
* **Files Changed:**
  * `packages/cli/src/components/input/FileMentionMenu.tsx`
  * `packages/cli/src/lib/file-scanner.ts`
  * `packages/cli/src/components/input/InputBar.tsx`
* **What:** Typing `@` scans the current working directory (respecting `.gitignore`), presents an inline fuzzy picker of file paths, and inserts the chosen relative path into the input bar.
* **Why:** Manually typing deep project paths like `packages/server/src/middleware/auth.ts` into a terminal prompt is tedious and error-prone.
* **How it helps us:** Drastically speeds up referencing specific codebase files directly in prompts.

---

## Phase 6: Browser-to-CLI OAuth & User Security

### Commit 6.1: Build temporary Bun loopback server for OAuth redirects
* **Files Changed:**
  * `packages/cli/src/auth/loopback-server.ts`
  * `packages/cli/src/auth/pkce.ts`
* **What:** Implements PKCE (Proof Key for Code Exchange) code verifier/challenge generation and starts an ephemeral local Bun HTTP server (`port: 0`) that waits for a single incoming OAuth callback request before shutting down.
* **Why:** Terminal apps cannot render complex web login forms (reCAPTCHA, Passkeys, Google Sign-In). A local loopback server allows the browser to pass the auth token back to the CLI securely.
* **How it helps us:** Enables seamless browser-based authentication directly from the terminal.

---

### Commit 6.2: Integrate Clerk OAuth browser flow and launch trigger
* **Files Changed:**
  * `packages/cli/src/auth/clerk.ts`
  * `packages/cli/src/commands/login.ts`
  * `packages/cli/package.json` (add `open`)
* **What:** Uses the `open` library to launch the user's default browser with Clerk's authorize URL containing the PKCE challenge and loopback callback port. Captures the authorization code and exchanges it for a session token.
* **Why:** Offloads identity management, multi-factor auth, and social sign-on to Clerk.
* **How it helps us:** Provides a secure, industry-standard authentication flow.

---

### Commit 6.3: Implement secure credentials disk store with restricted file permissions
* **Files Changed:**
  * `packages/cli/src/auth/token-storage.ts`
  * `packages/cli/src/auth/useAuth.ts`
* **What:** Writes received Clerk tokens and user metadata to `~/.nightcode/auth.json` with POSIX file permissions strictly set to `0o600` (read/write only by the file owner).
* **Why:** Storing credentials in world-readable files or raw environment variables exposes tokens to other processes or users on the local machine.
* **How it helps us:** Secures user tokens against unauthorized local system access.

---

### Commit 6.4: Secure Hono server routes with Clerk JWT verification
* **Files Changed:**
  * `packages/server/src/middleware/auth.ts`
  * `packages/server/src/app.ts`
* **What:** Creates Hono middleware to validate Clerk JWT bearer tokens against Clerk's public keys. Rejects unauthenticated requests and attaches `userId` to the request context.
* **Why:** Prevents unauthorized API access and ensures database operations are strictly scoped to the authenticated user.
* **How it helps us:** Protects backend endpoints and guarantees multi-tenant isolation.

---

## Phase 7: SaaS Monetization, Credit Metering & Rate Limiting

### Commit 7.1: Integrate Polar SDK for credit management
* **Files Changed:**
  * `packages/server/src/lib/polar.ts`
  * `packages/server/src/services/billing.ts`
  * `packages/server/package.json`
* **What:** Installs and configures `@polar-sh/sdk`. Defines custom meters for LLM token ingestion (`nightcode_usage`) and links Polar customer accounts to Clerk user IDs.
* **Why:** Running AI agents incur significant API costs; a billing engine is required to meter usage and monetize access.
* **How it helps us:** Establishes credit tracking and subscription management.

---

### Commit 7.2: Implement server-side credit balance gating middleware
* **Files Changed:**
  * `packages/server/src/middleware/credits.ts`
  * `packages/server/src/routes/chat.ts`
* **What:** Checks the user's remaining Polar credit balance before initiating any LLM streaming request. Returns `402 Payment Required` if the balance is exhausted.
* **Why:** Prevents users with zero credits from running up unpaid LLM API bills.
* **How it helps us:** Protects against abuse and guarantees payment before token consumption.

---

### Commit 7.3: Ingest token consumption into Polar on generation completion
* **Files Changed:**
  * `packages/server/src/services/token-tracker.ts`
  * `packages/server/src/routes/chat.ts`
* **What:** Extracts input, output, and cache token metrics on stream finish (`onFinish` callback) and asynchronously reports ingestion events to Polar to deduct the appropriate credit amount.
* **Why:** Different models (Opus vs. Haiku) carry radically different costs; billing must reflect exact token counts.
* **How it helps us:** Automates precise, usage-based credit deduction per request.

---

### Commit 7.4: Add `/usage` and `/upgrade` billing CLI dialogs
* **Files Changed:**
  * `packages/cli/src/components/dialogs/UsageDialog.tsx`
  * `packages/cli/src/commands/upgrade.ts`
  * `packages/cli/src/components/command-menu/commands.ts`
* **What:** `/usage` displays the current credit balance and recent token deductions. `/upgrade` generates a Polar checkout URL and opens it in the browser.
* **Why:** Users need transparent visibility into their remaining balance and an effortless way to purchase more credits without leaving the terminal flow.
* **How it helps us:** Provides a frictionless monetization and self-service top-up loop.

---

## Phase 8: Client-Side Tool Execution Engine (The Critical Refactor)

> **Context:** In the original video architecture, tools initially ran on the remote Hono server. When deployed to Railway, the agent could not read or edit files on the user's local machine! This phase implements the critical refactor: **moving tool execution entirely to the CLI process on the user's machine**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (CLI)                              │
│                                                                        │
│   Prompt + Context ──────────────────────────┐                         │
│                                              ▼                         │
│                              packages/server (Hono Relay)              │
│                                              │                         │
│                                              ▼                         │
│                                         Anthropic                      │
│                                              │                         │
│   Tool Call Decision ◄───────────────────────┘                         │
│   ("read_file", path: "src/app.ts")                                    │
│          │                                                             │
│          ▼                                                             │
│   local-tools.ts (Executes on user's local filesystem)                 │
│          │                                                             │
│          ▼                                                             │
│   Tool Result ───────────────────────────────┐                         │
│                                              ▼                         │
│                              packages/server (Hono Relay)              │
│                                              │                         │
│                                              ▼                         │
│                                         Anthropic                      │
│                                              │                         │
│   Next Stream Chunk ◄────────────────────────┘                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Commit 8.1: Define tool schemas and contracts in packages/shared
* **Files Changed:**
  * `packages/shared/src/tools/schemas.ts`
  * `packages/shared/src/tools/types.ts`
* **What:** Defines Zod schemas and descriptions for local tools:
  * `read_file`: Read contents of a local file.
  * `write_file`: Create or overwrite a local file.
  * `edit_file`: Targeted search-and-replace block edits.
  * `list_directory`: Inspect directories recursively.
  * `glob`: Find files matching wildcard patterns.
  * `grep`: Search file contents using regex.
  * `bash`: Execute shell commands and capture stdout/stderr.
* **Why:** Tool contracts must be shared between the server (which instructs the LLM) and the client (which runs the tools).
* **How it helps us:** Guarantees strict type safety across the tool invocation boundary.

---

### Commit 8.2: Implement local filesystem tool executors in packages/cli
* **Files Changed:**
  * `packages/cli/src/lib/local-tools.ts`
  * `packages/cli/src/lib/fs-utils.ts`
* **What:** Implements the actual execution logic for all 7 tools using Node/Bun `fs/promises` and `child_process`, executing strictly relative to `process.cwd()` on the user's machine.
* **Why:** Solves the core architectural limitation of the remote server. The agent must read, search, and edit the code that lives in the developer's local working directory.
* **How it helps us:** Enables the agent to inspect and modify local project files safely.

---

### Commit 8.3: Refactor chat loop to client-side tool execution via `useChat`
* **Files Changed:**
  * `packages/cli/src/hooks/useAgentLoop.ts`
  * `packages/cli/src/views/SessionView.tsx`
  * `packages/server/src/routes/chat.ts`
* **What:** Refactors the chat client to use Vercel AI SDK's client-side `useChat` with the `onToolCall` lifecycle handler. When the LLM decides to call a tool, the client:
  1. Intercepts the tool call locally.
  2. Executes it via `local-tools.ts` on the local machine.
  3. Returns the output back to the model to continue reasoning.
* **Why:** Completely decouples file execution from the remote Hono server, allowing the backend to remain a stateless proxy on Railway while the CLI retains local execution authority.
* **How it helps us:** The agent can now edit real projects anywhere in the developer's filesystem.

---

### Commit 8.4: Add user confirmation prompts for destructive tools
* **Files Changed:**
  * `packages/cli/src/components/dialogs/ConfirmToolDialog.tsx`
  * `packages/cli/src/lib/local-tools.ts`
* **What:** Intercepts `write_file`, `edit_file`, and arbitrary `bash` commands with an interactive terminal confirmation prompt (Allow once, Always allow this session, Deny).
* **Why:** Unrestricted execution of arbitrary shell commands or file rewrites poses a security risk to the user's codebase and machine.
* **How it helps us:** Gives developers complete oversight and veto power over destructive actions.

---

### Commit 8.5: Group tool executions visually in message list
* **Files Changed:**
  * `packages/cli/src/components/chat/ToolCallBlock.tsx`
  * `packages/cli/src/components/chat/BotMessage.tsx`
* **What:** Groups consecutive tool invocations (e.g., reading 4 files in a row) into a collapsible, formatted accordion showing input parameters, execution duration, and exit status.
* **Why:** Raw tool outputs can span hundreds of lines, drowning out the model's actual conversational response.
* **How it helps us:** Keeps the terminal message view clean, compact, and scannable.

---

## Phase 9: Distribution, Packaging & Production Polish

### Commit 9.1: Build executable CLI entry point binary wrapper
* **Files Changed:**
  * `packages/cli/bin/nightcode.js`
  * `packages/cli/package.json`
* **What:** Adds a `#!/usr/bin/env bun` shebang launcher script in `packages/cli/bin`, declares the `"bin": { "nightcode": "./bin/nightcode.js" }` entry point, and validates terminal raw-mode TTY capabilities on startup.
* **Why:** Users must be able to run `nightcode` as a standard CLI command from any folder on their machine.
* **How it helps us:** Makes the CLI globally executable via `bun link` or `npm install -g`.

---

### Commit 9.2: Add Railway deployment configuration for packages/server
* **Files Changed:**
  * `railway.json`
  * `packages/server/Dockerfile`
  * `.github/workflows/deploy.yml`
* **What:** Creates a minimal Dockerfile for Bun to run `packages/server` in production, along with Railway deployment definitions and automated deployment triggers.
* **Why:** The backend must run on a reliable, public URL to process Clerk OAuth callbacks and proxy LLM requests with low latency.
* **How it helps us:** Provides production cloud hosting for the relay backend and database connection pool.

---

### Commit 9.3: Add Automated AI Code Reviews via CodeRabbit
* **Files Changed:**
  * `.coderabbit.yaml`
* **What:** Configures CodeRabbit configuration with project-specific guidelines (enforcing responder stack safety, checking for leakages in tool calls, validating Zod input parsing).
* **Why:** Catches regressions, unhandled edge cases, and architectural anti-patterns automatically on every pull request.
* **How it helps us:** Ensures consistent code quality across monorepo packages.

---

### Commit 9.4: Add clean exit traps and terminal restore routines
* **Files Changed:**
  * `packages/cli/src/lib/terminal-cleanup.ts`
  * `packages/cli/src/index.tsx`
* **What:** Adds process exit listeners on `SIGINT`, `SIGTERM`, and `uncaughtException` to explicitly restore standard cursor visibility, disable mouse tracking, reset raw mode, and clear alternate screen buffers before exiting.
* **Why:** If a terminal UI crashes or exits improperly, it can leave the user's terminal in a broken state (hidden cursor, garbled text, non-echoing input).
* **How it helps us:** Leaves the user's shell completely clean and functional every time the program exits.

---

## Summary Matrix

| Phase | Core Focus | Commits | Primary Tech Stack |
| :--- | :--- | :---: | :--- |
| **Phase 1** | Workspace & TUI Foundation | `1.1` – `1.5` | Bun Workspaces, Open TUI, React |
| **Phase 2** | Navigation & Modals | `2.1` – `2.4` | React Router (Memory), Local Config |
| **Phase 3** | Backend & Database | `3.1` – `3.4` | Hono, Bun, Neon PostgreSQL, Prisma, Sentry |
| **Phase 4** | Real-Time Chat Engine | `4.1` – `4.4` | Vercel AI SDK, Hono SSE, AbortController |
| **Phase 5** | Agent Modes & File Mentions | `5.1` – `5.4` | System Prompts, Fast-Glob, Date-fns |
| **Phase 6** | Auth & Security | `6.1` – `6.4` | Clerk OAuth, PKCE, Bun Loopback, 0o600 Permissions |
| **Phase 7** | Billing & Metering | `7.1` – `7.4` | Polar SDK, Event Ingestion, Credit Gating |
| **Phase 8** | Client Tool Execution | `8.1` – `8.5` | Local Filesystem, Child Process, `useChat` |
| **Phase 9** | Distribution & Polish | `9.1` – `9.4` | `bun link`, Docker, Railway, CodeRabbit |