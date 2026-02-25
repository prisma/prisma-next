# Prisma Next CLI Style Guide

This guide defines how Prisma Next’s CLI behaves and looks. It exists to keep our developer experience consistent across commands and packages while aligning with our architecture: contract‑first, deterministic, agent‑friendly.

## Principles
- Human‑first TTY output; CI/agents get deterministic, parseable output.
- Deterministic behavior: stable exit codes, PN error codes, and JSON schemas.
- Actionable feedback: every error tells the user why it happened and what to do next.
- Respect boundaries: migration vs runtime plane, and family hooks for family‑specific logic.
- Minimal ceremony: tasteful color/symbols; banners only for `init`.

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
- Respect `NO_COLOR`/`FORCE_COLOR`, auto‑disable color/spinners in non‑TTY and CI.

## Verbosity & Flags
- Defaults: concise informational output in TTY with tasteful color/spinners.
- Quiet: `-q/--quiet` (errors only), `--silent` (fatal only, no spinners).
- Verbose: `-v` (debug: timings, resolved config), `-vv/--trace` (deep internals, stack traces).
- JSON: `--json` auto‑selects single object or NDJSON by command; override with `--json=object|ndjson`.
- Interactivity: `--interactive`/`--no-interactive`. `-y/--yes` accepts prompts.
- Timestamps: `--timestamps` adds ISO times to human output.
- Env toggles: `PRISMA_NEXT_DEBUG=1` ≅ `-v`, `PRISMA_NEXT_TRACE=1` ≅ `-vv`.

## Help & Usage
- **Styled Help Output**: Help output uses the same styled format as normal command output for consistency:
  - Root help (`prisma-next --help`): Shows "prisma next" title with subcommands listed
  - Command help (`prisma-next db verify --help`): Shows "next <command> ➜ <description>" with options, subcommands, and docs URLs
  - Help formatters are in `packages/1-framework/3-tooling/cli/src/utils/output.ts` and use `configureHelp()` in `cli.ts`
- **Fixed-Width Columns**: All two-column output (help, styled headers) uses fixed 20-character left column width for consistent alignment
- **Text Wrapping**: Right column wraps at 90 characters using `wrap-ansi` for ANSI-aware wrapping that preserves color codes
- **Default Values**: Options with default values display `default: <value>` on the following line (dimmed)
- **ANSI-Aware Formatting**: Uses `string-width` and `strip-ansi` to measure and pad text correctly, accounting for ANSI escape codes
- **Parameter Labels**: Styled headers show parameter labels with colons (e.g., `config:`, `contract:`)
- Include 1–2 copy‑pastable examples by default.
- Show aliases and defaults inline for options.
- Enable "Did you mean …" command suggestions.

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
- Diffs: unified diff for DDL with `--show-diff` (auto at `-vv`).
- Annotations: inline capability gates; warnings as `⚠`.
- Timings: total + per‑step at `-v`, full timings at `-vv`.
- Params: show placeholders; never print secrets. Sample values only at `-vv` and scrubbed.
- JSON: `--json=object` for plan; `--json=ndjson` streams events for preflight/apply.

## Interactivity
- Interactive by default: `init`, `migration apply`, `doctor` (future).
- Non‑interactive by default: `contract emit`, `migration plan`, `migration preflight`, `db verify`, `db sign`, `status`.
- Non‑TTY/CI: never prompt; fail if input is required unless `--yes` provided.

## Config & Environment
- Config file names: `prisma-next.config.ts|.mjs|.js` (ESM); optional CJS fallback.
- Discovery precedence: `--config <path>` > `PRISMA_NEXT_CONFIG` > nearest `prisma-next.config.*` in CWD (no upward search).
- Precedence: flags > config > defaults.
- Env policy: the CLI does not auto‑load `.env`. Apps may do so in `prisma-next.config.*` and pass values (e.g., `db.connection`).
- Contract source/output and migration directory: defined in config; flags should not override (for now).
- DB Connection: `--db=<URL>` or `config.db.connection`.

## Exit Codes & Streams
- Exit codes: `0` success, `1` runtime/error, `2` usage/config error.
- stdout for normal output/results; stderr for warnings/errors.
- All errors include PN codes; CI should match on PN codes rather than exit code granularity.

## JSON Semantics
- Auto mode (`--json`):
  - Single JSON object for short, non‑interactive commands (e.g., `contract emit`, `db verify`, `status`).
  - NDJSON event stream for long/interactive commands (e.g., `migration preflight`, `migration apply`, `init`).
- Override with `--json=object|ndjson`.

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
  - After‑init output: small celebratory header + “Next steps” checklist.
- Artifacts: commit `contract.json` and `contract.d.ts` to VCS by default.

## Flag Conventions
- Kebab‑case long flags; negation via `--no-<flag>` for booleans.
- Short aliases only for high‑frequency flags: `-v`, `-q`, `-y`, `-h`, `-V`.
- Numbers are plain (`--max-sql-lines 10`); durations use `--timeout-ms`.
- Global flags: `--json[=object|ndjson]`, `-v`, `-vv`, `-q`, `--silent`, `--interactive`, `--no-interactive`, `-y/--yes`, `--color/--no-color`, `--timestamps`, `--config <path>`, `--db <url>`.
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
- **Delay threshold**: Only show spinner if operation takes >100ms to avoid flicker on fast operations.
- **Respect flags**: Disable spinners when:
  - `--quiet` or `--silent` flag is set
  - `--json` output is enabled (JSON should be deterministic, no animations)
  - Non-TTY environment (CI, pipes, redirects)
- **Implementation**: Use `ora` package for spinners. Wrap async operations with spinner utility that:
  - Starts timer when operation begins
  - Only creates/start spinner if operation exceeds delay threshold
  - Shows success message with elapsed time: `✔ Operation name... (123ms)`
  - Shows failure message on error: `✖ Operation name... failed: error message`
- **Output spacing**: Add a single blank line after all async operations complete (not between individual operations) to separate spinner output from command results.

## Testing & Accessibility
- Width/wrapping: measure visible width, wrap long lines (use `string-width`, `wrap-ansi`, `strip-ansi`).
  - Fixed 20-character left column width for all two-column output (help, styled headers)
  - Right column wraps at 90 characters using `wrap-ansi` for ANSI-aware wrapping
  - Use `string-width` to measure display width and `strip-ansi` to remove ANSI codes when needed
- Non‑TTY: disable animations/spinners; fall back to plain lines.
- i18n readiness: avoid baked‑in ASCII art; keep text compact and translatable.
- Security: never print secrets; scrub parameters and connection strings.

## Quick Reference
- Global: `--json[=object|ndjson]`, `-q`, `--silent`, `-v`, `-vv`, `--timestamps`, `--interactive`, `-y`, `--config <path>`, `--db <url>`.
- Commands:
  - `contract emit --contract prisma/contract.ts --out src/prisma`
  - `migration plan --out migrations/next`
  - `migration preflight --show-sql`
  - `migration apply --yes`
  - `db verify --db $DATABASE_URL`
  - `db sign --db $DATABASE_URL --force`

---

This guide is the single source of truth for CLI behavior. When in doubt, prefer the defaults here and keep the UX friendly, informative, and consistent with our contract‑first architecture.
