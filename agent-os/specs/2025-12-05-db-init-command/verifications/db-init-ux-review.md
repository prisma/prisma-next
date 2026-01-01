# db init UX review (2026‑01‑02)

Manual matrix runs were executed with the shared CLI fixture app (`test/integration/test/fixtures/cli/cli-e2e-test-app`).
Raw transcripts (stdout, stderr, exit codes, commands) are stored in
`db-init-ux-review.before.json` in this same directory.

> **Note**: The “permission denied” scenario could not be captured because the dev database
> allows only one connection at a time and rejects repeated attempts to alter role grants in a
> predictable way. Everything else in the acceptance matrix (human + JSON) was executed.

## Scenario snapshots (before changes)

| Scenario | Mode | Command (relative) | Exit | Actionable? | Notes (stdout/stderr summary) |
|----------|------|--------------------|------|-------------|-------------------------------|
| Empty apply | human | `prisma-next db init --config scenario.config.ts --no-color` | 0 | ✅ | Styled header + spinner + “Applied 1 operation(s) … Marker written …” |
| Empty apply | json | `prisma-next db init --config scenario.config.ts --json` | 0 | ✅ | JSON envelope only (no header) |
| Plan mode | human | `… --plan --no-color` | 0 | ✅ | “Planned 1 operation(s)” tree + dry-run reminder |
| Idempotent rerun | human | `… --no-color` (after apply) | 0 | ✅ | “Applied 0 operation(s)” |
| Missing contract file | human | `… --no-color` | 2 | ⚠️ | Error PN-CLI-4004, fix says “Check that the file path is correct” (no hint to emit contract or default location) |
| Invalid contract JSON | human | `… --no-color` | 2 | ⚠️ | Error PN-CLI-4999 “Unexpected error”, generic fix |
| Missing db.url | human | `… --no-color` | 2 | ⚠️ | Error PN-CLI-4005 fix says “Provide --db flag or config.db.url” (no examples, no mention of default path) |
| Missing driver | human | `… --no-color` | 2 | ⚠️ | Error PN-CLI-4010 fix says “Add driver to prisma-next.config.ts” (no guidance on import path) |
| Target lacks migrations | human | `… --no-color` | 2 | ⚠️ | Error PN-CLI-4021 fix “Ensure you are using a target that supports migrations” (no indication of which target(s) do) |
| Connect failure | human/json | `… --no-color` / `… --json` | 1 | ❌ | Raw Node “Error: connect ECONNREFUSED … stack” printed, no structured Why/Fix |
| Planner conflict | human | `… --no-color` | 1 | ⚠️ | Only summary “Database schema does not satisfy contract (1 failure)” with generic fix, no conflict list unless `--verbose` |
| Marker mismatch | json | `… --json` | 1 | ⚠️ | Error fix instructs “Use `prisma-next db migrate`…”, command doesn’t exist |
| `--json ndjson` | ndjson flag | `prisma-next db init --config scenario.config.ts --json ndjson` | 0 | ❌ | Human header + spinner + success text printed; not machine-readable NDJSON |

## Implemented improvements (after)

- **Reject unsupported `--json ndjson`**: `db init` now fails fast with a structured CLI error (no header/spinner), and JSON errors are machine-readable whenever any `--json` mode is set.
- **Contract file errors are actionable**: missing contract file and invalid JSON point users at `prisma-next contract emit` and include file paths.
- **Connection failures are structured**: connect errors are caught and converted into a structured RTM error with redacted connection meta (no password) instead of raw stacks.
- **Schema mismatch failures carry details**: runner failures now preserve `failure.meta` and the human formatter prints a short list of `issues`/`conflicts` without requiring `--verbose`.
- **Marker mismatch fix copy is corrected**: no longer references a non-existent `prisma-next db migrate`.

## Punchlist

1. **Missing / invalid contract errors are not actionable.** Fix strings never mention
   `prisma-next contract emit`, default output location, or config keys.
2. **Database configuration errors are generic.** `errorDatabaseUrlRequired`, `errorDriverRequired`,
   and `errorTargetMigrationNotSupported` do not provide concrete steps or snippets.
3. **Connection failures leak raw stack traces.** Rejected connections (bad host/port) show Node
   ECONNREFUSED dumps instead of structured CLI/RTM errors with a Fix.
4. **Planner conflicts hide conflict summaries unless `--verbose`.** Human output only says
   “Database schema does not satisfy contract (1 failure)” with no hints about what conflicting
   objects were found.
5. **Marker mismatch references a non-existent command.** Fix suggests
   `prisma-next db migrate`, which doesn’t exist in this repo snapshot.
6. **`--json ndjson` mode is not actually supported.** Command prints the styled human output even
   though `--json [format]` advertises `ndjson`; consumers cannot parse the result.
7. **`errorUnexpected` is being used for invalid JSON.** Leads to “Unexpected error” summary even
   though the error is user-facing and should provide guidance.
8. **Permission-denied repro is still missing.** The dev DB environment makes it hard to reliably
   trigger privilege errors, but the `db init` runner failure wrapper now special-cases
   `meta.sqlState === '42501'` to provide privilege guidance.

## Proposed copy & formatting changes (aligned with plan)

1. **Improve contract file errors (db-init.ts + error factories).**
   - Missing file fix: “Run `prisma-next contract emit` and ensure `config.contract.output`
     (default `src/prisma/contract.json`) exists.”
   - Invalid JSON: introduce a structured error (use `errorContractValidationFailed`) so summary is
     “Contract JSON is invalid” with Fix pointing to re-emitting the contract.

2. **Tighten config-related errors.**
   - `errorDatabaseUrlRequired`: add explicit instructions (“Set `db: { url: 'postgres://…' }` in
     `prisma-next.config.ts` or pass `--db <url>`”) and include an example snippet.
   - `errorDriverRequired`: mention the control driver import path and the config key to set.
   - `errorTargetMigrationNotSupported`: mention the actual target id that was loaded and tell users
     to select one that exposes `target.migrations`.

3. **Wrap Postgres control driver `connect()` with structured errors.**
   - Catch connection failures, map them to `errorRuntime('Database connection failed', …)` with
     action items: verify host/port, try `psql <url>`, check network.
   - Include redacted meta (host/port) for debugging; avoid leaking passwords.

4. **Planner conflict ergonomics.**
   - Ensure `errorMigrationPlanningFailed` fix mentions db init being additive-only, suggests
     dropping/resetting for bootstrap or reconciling schema via migrations.
   - In human formatter, show first few conflicts inline even without `--verbose`, and recommend
     re-running with `--trace` for full details.

5. **Marker mismatch fix.**
   - Replace `prisma-next db migrate` guidance with “If bootstrapping, drop/reset the database then
     rerun `db init`; otherwise use your migration workflow to reconcile from the existing contract.”

6. **Reject `--json ndjson` cleanly.**
   - Update `db-init.ts` option description (remove ndjson) and, if user passes it, throw a CLI
     error explaining ndjson is not supported for this command. No header/spinner should print
     before the error; JSON mode should emit a structured envelope, not styled text.

7. **Invalid JSON path uses `errorUnexpected`.**
   - Swap to a contract-specific error that retains the file path in `where` and offers a fix to
     re-emit. Avoid “Unexpected error” summaries for user mistakes.

8. **Permission-denied follow-up.**
   - We still need to craft a reproducible scenario (likely via a fixture DB or a mock runner) and,
     once `runner.meta.sqlState === '42501'`, override Fix with privilege guidance.

These issues line up with the implementation plan (reject ndjson, improve copy, preserve runner
meta, structured connection errors, and test coverage). Once addressed, rerun the matrix and update
this doc with “after” transcripts. For now the JSON file contains complete “before” data for all
tested scenarios (29 entries).***

