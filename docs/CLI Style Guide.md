# Prisma Next CLI Style Guide

This guide defines how Prisma Next's CLI behaves and looks. It exists to keep our developer experience consistent across commands and packages while aligning with our architecture: contract‑first, deterministic, agent‑friendly.

## Principles
- Human‑first TTY output; CI/agents get deterministic, parseable output.
- Deterministic behavior: stable exit codes, PN error codes, and JSON schemas.
- Actionable feedback: every error tells the user why it happened and what to do next.
- Respect boundaries: migration vs runtime plane, and family hooks for family‑specific logic.
- Minimal ceremony: tasteful color/symbols; clack-like decorations are ok; banners only for `init`.

## Command Taxonomy
- Group commands by domain/plane with noun → verb phrasing.
  - `contract emit`
  - `migration plan | preflight | apply | status`
  - `db verify | sign`
- Aliases: we will add flat verb aliases later for common flows, but the canonical shape is domain‑first.
- No colon (`db:sign`) forms; prefer space‑separated subcommands. Optional short group aliases (e.g., `db`) are fine; avoid long forms (e.g., `database`).

## Output Style
- Tone: friendly‑approachable, polished, concise. Symbols only (no emojis).
- Symbols: success `✔`, error `✖`, warn `⚠`, info `ℹ`, step `›`, arrow `→`.
- Colors: success=green, error=red, warn=yellow, info=cyan, accent=magenta, secondary text=dim.
- Paths: Show relative paths from current working directory (not absolute paths) for better readability
- Banners: only for `init` (first‑run experience). Otherwise, focus on getting work done.
- Respect `NO_COLOR`, auto‑disable color/spinners in non‑TTY and CI. Use `--color` flag to force color when needed.

## Output Conventions: Composable CLI Output

The CLI follows the Unix convention of separating human-readable decoration from machine-readable data:

- **stdout** — data output only (`ui.output()`). This is what scripts and pipes capture.
- **stderr** — all decoration (Clack spinners, logs, notes, intro/outro). Visible in terminal, invisible in pipes.

### Rules

1. **All `TerminalUI` methods except `output()` write to stderr** via Clack's `{ output: process.stderr }` option — but only in interactive mode.
2. **`ui.output(data)` always writes to stdout** — call it only when there is data to emit (e.g., `--json` responses). Commands gate `ui.output()` behind `if (flags.json)`.
3. **When stdout is piped, ALL decoration is suppressed** — `isInteractive` (`process.stdout.isTTY`) gates every decoration method. Only `ui.output()` writes in piped mode. This keeps `prisma-next db verify | jq` completely silent.
4. **Action commands** (sign, init) produce no stdout data — they are purely decorative.
5. **Data commands** (verify, emit, introspect, status) call both decoration (stderr) and `ui.output()` (stdout). In interactive mode, decoration is visible on stderr; `ui.output()` writes to stdout only when the command has data to emit (gated by `--json`).
6. **Never write data to stderr** — decoration methods are for human context only.
7. **Never write decoration to stdout** — it breaks pipes, `$(...)` captures, and `> file` redirects.

### How it works in practice

The CLI checks `process.stdout.isTTY` once at startup to determine the output mode:

- **Interactive** (`stdout` is TTY): decoration visible on stderr. `ui.output()` writes to stdout when called (commands gate it behind `--json`).
- **Piped** (`stdout` is NOT TTY): decoration suppressed, `ui.output()` writes raw data to stdout.

## Verbosity & Flags
- Defaults: concise informational output in TTY with tasteful color/spinners.
- Quiet: `-q/--quiet` (errors only).
- Verbose: `-v/--verbose` (debug: timings, resolved config), `--trace` (deep internals, stack traces).
- JSON: `--json` outputs single JSON object to stdout.
- Interactivity: `--interactive`/`--no-interactive`. Defaults to `process.stdout.isTTY`. `-y/--yes` accepts prompts.
- Env toggles: `PRISMA_NEXT_DEBUG=1` ≅ `-v`, `PRISMA_NEXT_TRACE=1` ≅ `--trace`.
- CLI flags take precedence over env vars.

> **Future**: When streaming commands (`preflight`, `apply`) are implemented, `--json` may auto‑select NDJSON for those commands, and `--json=object|ndjson` override syntax can be re‑introduced.

## Help & Usage
- **Styled Help Output**: Help output uses the same styled format as normal command output for consistency:
  - Root help (`prisma-next --help`): Shows "prisma next" title with subcommands listed
  - Command help (`prisma-next db verify --help`): Shows "next <command> ➜ <description>" with options, subcommands, and docs URLs
  - Help formatters are in `packages/1-framework/3-tooling/cli/src/utils/formatters/` (multiple focused modules)
- **Fixed-Width Columns**: All two-column output (help, styled headers) uses fixed 20-character left column width for consistent alignment
- **Text Wrapping**: Right column wraps at 90 characters using `wrap-ansi` for ANSI-aware wrapping that preserves color codes
- **Default Values**: Options with default values display `default: <value>` on the following line (dimmed)
- **ANSI-Aware Formatting**: Uses `string-width` and `strip-ansi` to measure and pad text correctly, accounting for ANSI escape codes
- **Parameter Labels**: Styled headers show parameter labels with colons (e.g., `config:`, `contract:`)
- Include 1–2 copy‑pastable examples by default.
- Show aliases and defaults inline for options.
- Enable "Did you mean …" command suggestions.

## Command Suggestions
- When an unknown command is entered, the CLI suggests the closest match using Levenshtein distance.
- Suggestions appear only when the edit distance is within 40% of the input length (minimum 2).
- Up to 3 tied suggestions are shown.

## Errors
- Codes: `PN-<DOMAIN>-<NNNN>` (e.g., `PN-CLI-4002`, `PN-MIG-2001`, `PN-RTM-3005`, `PN-CON-1001`, `PN-SCHEMA-0001`).
- Human layout (TTY):
  - First line: `✖` concise summary + code
  - Why: one line cause
  - Fix: one line next step
  - Where: `file:line` when applicable
  - More: hint to rerun with `-v`/`--trace`; docs link by code
- JSON schema (single object): `{ code, domain, severity, summary, why, fix, where: { path, line }, meta, docsUrl }`.

## Plans & Preflights (Rendering)
- Summary header: target, storageHash/profileHash, op count, affected tables, estimated rows.
- Per‑op one‑liners: verb + table + key columns.
- SQL visibility: hidden by default; show with `--show-sql` or at `-v`. Truncate to 10 lines/op; override via `--max-sql-lines <n>`.
- Diffs: unified diff for DDL with `--show-diff` (auto at `--trace`).
- Annotations: inline capability gates; warnings as `⚠`.
- Timings: total + per‑step at `-v`, full timings at `--trace`.
- Params: show placeholders; never print secrets. Sample values only at `--trace` and scrubbed.
- JSON: `--json` for plan output.

## Interactivity
- Interactive by default: `init`, `migration apply`, `doctor` (future).
- Non‑interactive by default: `contract emit`, `migration plan`, `migration preflight`, `db verify`, `db sign`, `status`.
- Non‑TTY/CI: never prompt; fail if input is required unless `--yes` provided.
- `--interactive`/`--no-interactive` override the TTY detection.

## Config & Environment
- Config file names: `prisma-next.config.ts|.mjs|.js` (ESM); optional CJS fallback.
- Discovery precedence: `--config <path>` > `PRISMA_NEXT_CONFIG` > nearest `prisma-next.config.*` in CWD (no upward search).
- Precedence: flags > config > defaults.
- Env policy: the CLI does not auto‑load `.env`. Apps may do so in `prisma-next.config.*` and pass values (e.g., `db.connection`).
- Contract source/output and migration directory: defined in config; flags should not override (for now).
- DB Connection: `--db=<URL>` or `config.db.connection`.

## Exit Codes & Streams
- Exit codes: `0` success, `1` runtime/error, `2` usage/config error.
- stdout for data only; stderr for decoration, warnings, errors, and help text.
- All errors include PN codes; CI should match on PN codes rather than exit code granularity.

## JSON Semantics
- `--json` outputs a single JSON object for the command result to stdout regardless of TTY mode.
- When piped (`!isTTY`), no decoration is visible — only JSON data on stdout.

> **Future**: When streaming commands are implemented, NDJSON event streams (`--json=ndjson`) will be supported for commands like `migration preflight` and `migration apply`.

## Database Commands
- `db verify` (canonical):
  - Loads config + contract, connects via `--db` or `config.db.connection`.
  - Checks marker presence, `storageHash`/`profileHash` equality, target match.
  - Non‑interactive; single JSON with `--json`.
- `db schema-verify` (canonical):
  - Loads config + contract, connects via `config.db.connection` (or `--db` when supported).
  - Verifies that the live database schema satisfies the contract (catalog-based checks).
  - Non‑interactive; single JSON object with `--json`.
- `db sign` (canonical):
  - Runs the same verify phase first, then writes/updates the marker row.
  - Missing marker → insert; same hash → no‑op; different hash → never overwrite unless `--force`.
  - Options: `--force`, `--dry-run`, `--include-contract-json`, `--app-tag`, `--canonical-version`.

## Init Flow
- Prompts: target/adapter (default Postgres), optional extensions (do not recommend pgvector by default), language (TS default), paths (contract in `prisma/contract.ts`, outputs in `src/prisma`), package manager, telemetry (opt‑in), create example query + seed (optional), run `db sign` if `--db` provided.
- Scaffolds:
  - `prisma-next.config.ts` with selected family/target/adapter/extensions and paths.
  - Contract starter at `prisma/contract.ts`.
  - Scripts in `package.json`: `prisma:emit`, `prisma:plan`, `prisma:apply`, `prisma:sign -- --db=$DATABASE_URL`.
  - Optional example `src/queries/example.ts` and `scripts/seed.ts`.
  - `.env.example` with `DATABASE_URL=`; CLI still does not read `.env`.
  - After‑init output: small celebratory header + "Next steps" checklist.
- Artifacts: commit `contract.json` and `contract.d.ts` to VCS by default.

## Flag Conventions
- Kebab‑case long flags; negation via `--no-<flag>` for booleans.
- Short aliases only for high‑frequency flags: `-v`, `-q`, `-y`, `-h`, `-V`.
- Numbers are plain (`--max-sql-lines 10`); durations use `--timeout-ms`.
- Global flags: `--json`, `-v/--verbose`, `--trace`, `-q/--quiet`, `--interactive`, `--no-interactive`, `-y/--yes`, `--color/--no-color`, `--config <path>`, `--db <url>`.
- Per‑command examples:
  - `contract emit`: `--contract <path>`, `--out <dir>`, `--show-sql`, `--show-diff`.
  - `migration plan/preflight/apply`: `--out <dir>`, `--show-sql`, `--show-diff`, `--max-sql-lines <n>`, `--yes`.
  - `db sign`: `--include-contract-json`, `--app-tag`, `--canonical-version`, `--force`, `--dry-run`.

## Rationale
- Predictable, human‑oriented text with clear errors; mirror determinism and actionable messages while avoiding heavy codegen.
- Simple flags and migration UX; adopt concise help and guardrails while remaining contract‑first.
- Minimal flair; banners only for `init`.
- Prefer noun → verb command taxonomy (`db sign`, `db verify`) over colon commands for consistency.
- Follow established Node CLI best practices: short flags, colored output that respects environment, and robust help/usage.

## Loading Indicators & Spinners
- **When to use**: Show spinners for remote operations (database connections, network requests) that may take time.
- **Implementation**: Use `@clack/prompts` spinner on stderr via `TerminalUI.spinner()`. Spinners are automatically suppressed when piped (`!isTTY`), in `--quiet` mode, or with `--json` output.
- **Delay threshold**: Spinners use a 100ms delay threshold — they only appear if the operation takes longer, avoiding flicker for fast operations.
- **Output format**: Success message with elapsed time: `✔ Operation name (123ms)`. Failure: `✖ Operation name (failed)`.
- **Nested operations**: Rendered as step lines via `ui.step()` rather than separate spinners.

## Graceful Shutdown
- SIGINT (Ctrl+C) and SIGTERM are handled at CLI startup via a shared AbortController.
- First signal: aborts in-flight operations, starts a 3-second grace period for `finally` blocks to close connections.
- Second signal: force-exits immediately with code 130.
- Active spinners auto-cancel with "Interrupted" message on abort.

## Testing & Accessibility
- Width/wrapping: measure visible width, wrap long lines (use `string-width`, `wrap-ansi`, `strip-ansi`).
  - Fixed 20-character left column width for all two-column output (help, styled headers)
  - Right column wraps at 90 characters using `wrap-ansi` for ANSI-aware wrapping
  - Use `string-width` to measure display width and `strip-ansi` to remove ANSI codes when needed
- Non‑TTY: disable animations/spinners; fall back to plain lines.
- i18n readiness: avoid baked‑in ASCII art; keep text compact and translatable.
- Security: never print secrets; scrub parameters and connection strings.

## Quick Reference
- Global: `--json`, `-q`, `-v`, `--trace`, `--interactive`, `-y`, `--config <path>`, `--db <url>`.
- Commands:
  - `contract emit --contract prisma/contract.ts --out src/prisma`
  - `migration plan --out migrations/next`
  - `migration preflight --show-sql`
  - `migration apply --yes`
  - `db verify --db $DATABASE_URL`
  - `db sign --db $DATABASE_URL --force`

## Internal Architecture
- **TerminalUI** (`src/utils/terminal-ui.ts`): Composable output abstraction. All decoration goes to stderr via `@clack/prompts`, data goes to stdout. Accepts `color` and `interactive` overrides.
- **GlobalFlags / CommonCommandOptions** (`src/utils/global-flags.ts`): Parsed flags shared by all commands. `CommonCommandOptions` is the base interface for command option types.
- **addGlobalOptions()** (`src/utils/command-helpers.ts`): Registers global flags and help formatter on any Command. All commands use this instead of inline `.option()` calls.
- **Shutdown** (`src/utils/shutdown.ts`): Global AbortController for SIGINT/SIGTERM. Exposes `shutdownSignal` for cancellable async operations.
- **Formatters** (`src/utils/formatters/`): Output formatting split into focused modules — `emit.ts`, `errors.ts`, `verify.ts`, `migrations.ts`, `styled.ts`, `help.ts`, and shared `helpers.ts`.
- **Progress Adapter** (`src/utils/progress-adapter.ts`): Converts control-api progress events into Clack spinners on stderr.

---

This guide is the single source of truth for CLI behavior. When in doubt, prefer the defaults here and keep the UX friendly, informative, and consistent with our contract‑first architecture.
