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
- Codes: `PN-<DOMAIN>-<NNNN>` (e.g., `PN-CLI-4002`, `PN-MIG-2001`, `PN-RUN-3005`, `PN-CON-1001`, `PN-SCHEMA-0001`).
- Human layout (TTY):
  - First line: `✖` concise summary + code
  - Why: one line cause
  - Fix: one line next step
  - Where: `file:line` when applicable
  - More: hint to rerun with `-v`/`--trace`; docs link by code
- JSON schema (single object): `{ code, domain, severity, summary, why, fix, where: { path, line }, meta, docsUrl }`.
- **Missing-input failures**: when a command fails because required flags are missing in non-interactive mode, the envelope MUST set `meta.missingFlags: string[]` listing each missing flag's long form (e.g. `["--target", "--authoring"]`) so callers can react programmatically. The `fix:` text SHOULD list the same flags in canonical CLI form, copy-pasteable.

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
- Non‑TTY/CI: never prompt; fail with a structured precondition error if input is required.
- `--interactive`/`--no-interactive` override the TTY detection.
- **Every interactive prompt MUST have a flag-driven equivalent.** A command that requires user input without a corresponding flag is broken in non-interactive mode. Adding a new prompt requires adding the matching flag in the same change.
- **Interactivity requires both stdin and stdout to be TTYs.** Commands that prompt MUST check `process.stdin.isTTY && process.stdout.isTTY`. A closed stdin (`< /dev/null`, common in CI and AI agents) is non-interactive even when stdout is a TTY. `--interactive` overrides this only when both streams are actually capable of carrying input/output.
- **`-y`/`--yes` auto-accepts non-destructive prompts only.** It does NOT consent to data loss, overwriting generated files, or any other destructive action. Destructive operations require an explicit `--force` flag (see [Destructive operation confirmation](#destructive-operation-confirmation)).

### Destructive operation confirmation

Destructive operations (drops, type changes, overwriting generated files, overwriting an existing signature marker, …) require **explicit consent via `--force`**, separate from the `-y` "skip non-destructive prompts" mechanism.

This is a deliberate divergence from clig.dev §Arguments §Confirmation. AI agents and CI scripts routinely pass `-y` to suppress prompts on long-running pipelines; conflating "skip prompts" with "consent to destruction" is a footgun the project has decided to avoid.

#### Rules

- A command that performs a destructive action MUST prompt for confirmation in interactive mode AND require `--force` to skip the prompt or to run the action non-interactively.
- The prompt MUST list the destructive operations (or describe them concretely, e.g. "this will overwrite all generated files") so the user can decline knowing what's at stake.
- In non-interactive mode (piped stdout, closed stdin, `--no-interactive`, `--json`) without `--force`: no prompt is shown; the command fails with a structured precondition error (exit code `2`) whose `fix:` names `--force`.
- `-y`/`--yes` MUST NOT be a substitute for `--force`. A non-interactive invocation with `-y` but without `--force` against a destructive operation MUST still fail.
- The internal control API retains a programmatic equivalent (e.g. `acceptDataLoss: boolean`) for consumers that drive the planner directly; `--force` is the user-facing CLI flag.

#### Examples

- `migration apply` / `db update`: when the plan includes destructive ops, prompts in interactive mode; requires `--force` to apply without a prompt or in non-interactive mode.
- `db sign`: requires `--force` to overwrite an existing marker with a different hash (already documented in [Database Commands](#database-commands)).
- `prisma-next init`: re-running `init` in a directory with a generated `prisma-next.config.ts` requires `--force`; `-y` alone is not sufficient to authorise overwriting generated files.

## Config & Environment
- Config file names: `prisma-next.config.ts|.mjs|.js` (ESM); optional CJS fallback.
- Discovery precedence: `--config <path>` > `PRISMA_NEXT_CONFIG` > nearest `prisma-next.config.*` in CWD (no upward search).
- Precedence: flags > config > defaults.
- Env policy: the CLI does not auto‑load `.env`. Apps may do so in `prisma-next.config.*` and pass values (e.g., `db.connection`).
- Contract source/output and migration directory: defined in config; flags should not override (for now).
- DB Connection: `--db=<URL>` or `config.db.connection`.

## Exit Codes

Exit codes are a **coarse classification** of command outcomes, intended for shell-level branching (`if ! prisma-next ...; then`) and CI gates. Fine-grained discrimination uses **PN error codes** — every structured error carries one, and scripts that need to react to a specific failure mode (e.g. "retry on `PN-CLI-5004` but fail on `PN-CLI-5003`") MUST match on the PN code.

Streams are covered in [Output Conventions](#output-conventions-composable-cli-output): stdout is data-only; stderr carries decoration, warnings, errors, and help.

### Reserved (CLI-wide)

These codes have a fixed meaning across every Prisma Next CLI command. Specific commands MUST NOT redefine them.

| Code | Name | Meaning |
|---|---|---|
| `0` | `OK` | Command succeeded. |
| `1` | `INTERNAL_ERROR` | Unexpected internal failure, crash, or bug. The command did not reach a documented outcome. Reserved for "this should not have happened". |
| `2` | `PRECONDITION` | Usage / configuration / precondition error: bad flags, missing required input, conflicting flags, missing prerequisite file. "Your invocation was wrong, fix it and try again." Matches commander.js and Linux convention (`misuse of shell builtin`). |
| `3` | `USER_ABORTED` | The user explicitly declined an interactive prompt (e.g. did not consent to a destructive overwrite). Distinct from signal-based interruption. |
| `130` | — | Interrupted by SIGINT (Ctrl+C). POSIX convention (`128 + 2`). |
| `143` | — | Terminated by SIGTERM. POSIX convention (`128 + 15`). |

### Command-specific (open-ended)

Codes `4`–`99` are available for command-specific outcome codes. Each command:

- MUST define its codes in a co-located, exported module (e.g. `src/commands/<command>/exit-codes.ts`) so consumers can import them by name rather than literal.
- MUST document each code in its `--help`, package `README.md`, or both.
- SHOULD pick names that describe an **outcome shape** (`INSTALL_FAILED`, `VERIFY_DRIFT`, `PLAN_HAS_DESTRUCTIVE_OPS`), not a specific cause.

The same numeric value MAY mean different things in different commands (e.g. `init`'s `4 = INSTALL_FAILED` is unrelated to a hypothetical `migration apply 4`). Exit codes are always interpreted in the context of the command that produced them; the PN code disambiguates within the class.

Codes `100` and above are reserved for runtime-environment signals (POSIX `128 + N`) and MUST NOT be claimed by a command.

### Promoting a command-specific code to CLI-wide

If a category of failure recurs across multiple commands and would benefit from a stable cross-command meaning, it MAY be promoted into the reserved range. Promotion is a breaking change to any command that already used that numeric code in the open range, MUST renumber every prior use, and MUST be flagged in release notes. Treat command-specific codes as conventionally stable, like any other public API.

### Why both exit codes and PN codes?

Exit codes are the right tool for shell pipelines: they're a single integer, every shell understands them, and matching on them is one line of bash. They MUST stay coarse — pipelines built on exit-code matching are surprisingly common, and a small reserved core is enough for almost every shell-level decision.

PN error codes (`PN-CLI-5003`, `PN-MIG-2001`, etc.) are the precise channel — every structured error carries one. Scripts that need to discriminate between two specific failure modes that share an exit code MUST match on the PN code, not the exit code.

## JSON Semantics
- `--json` outputs a single JSON object for the command result to stdout regardless of TTY mode.
- When piped (`!isTTY`), no decoration is visible — only JSON data on stdout.
- **Each command's `--json` success shape MUST be defined as a schema** (arktype or equivalent) co-located with the command (e.g. `src/commands/<command>/output.ts`) and exported on the package's public surface, so downstream consumers can validate the output. The error envelope schema is shared (see [Errors](#errors)). Hand-writing JSON without a co-located schema is not allowed.
- Success and error documents on the same command SHOULD share a discriminator field (typically `ok: boolean`) so consumers can branch without inspecting the structure.

> **Future**: When streaming commands are implemented, NDJSON event streams (`--json=ndjson`) will be supported for commands like `migration preflight` and `migration apply`.

## Database Commands
- `db verify` (canonical):
  - Loads config + contract, connects via `--db` or `config.db.connection`.
  - Default mode checks marker presence, `storageHash`/`profileHash` equality, target match, then runs schema verification.
  - `--marker-only` performs marker-only verification.
  - `--schema-only` skips marker checks and verifies only that the live schema satisfies the contract.
  - `--strict` makes schema verification fail when the database includes elements not present in the contract.
  - `--marker-only` cannot be combined with `--schema-only` or `--strict` (exit code 2, `PN-CLI-4012`). `--schema-only --strict` is valid.
  - Non‑interactive; single JSON with `--json`.
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
