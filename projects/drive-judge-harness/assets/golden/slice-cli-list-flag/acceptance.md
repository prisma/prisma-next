# Acceptance set — slice-cli-list-flag

## Expected triage verdict

`in-project-slice` (or `orphan-slice` if run standalone). It is one coherent PR: a flag on one command, one reviewer sitting, one rollback unit. It is **not** a project (no multi-slice sequencing) and **not** a direct change (it adds a user-facing surface + new tests + a documented JSON shape, more than ~30 seconds to verify).

## Expected outcome / requirements

- **AC-1** — A `--json` flag exists on the migration-list command.
- **AC-2** — With `--json`, the command emits structured JSON of the migration-list data to stdout; the field shape is documented (in code types and/or the command's help/README).
- **AC-3** — Without `--json`, the styled human rendering is unchanged (existing tests for the default path still pass untouched).
- **AC-4** — The JSON path and the human path derive from the **same** data source — no divergent re-computation. (Reviewer-checkable: both call the same data-building function.)
- **AC-5** — Error conditions (e.g. missing migrations) are handled in both modes with consistent exit codes.
- **AC-6** — Tests cover the `--json` output shape and the unchanged default.

## Correctness oracle

- **Mechanical:** `pnpm typecheck` + the CLI package tests pass, including new `--json` tests.
- **Requirements:** AC-1…AC-6 against the diff.
- **Intent:** the JSON is a faithful, stable projection of the same migration-list model the human view renders — a consumer could build tooling on it. Shared-source (AC-4) is the key design-quality signal: a correct run threads the flag through the existing data path, it does not fork a parallel computation.

## Failure modes a correct run avoids

- Re-deriving the migration list independently for JSON (drift risk) instead of projecting the shared model.
- Changing the default human output to satisfy the new flag.
- Emitting JSON interleaved with styling/log noise on stdout (unparseable).
- Promoting this to a multi-slice project (scope inflation) or collapsing it to an unreviewed direct change (scope under-shaping).
