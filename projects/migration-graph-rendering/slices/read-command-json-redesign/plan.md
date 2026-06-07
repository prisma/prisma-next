# Dispatch plan — read-command-json-redesign

Eight sequential dispatches. The cut is forced by two facts: the field renames live in **shared** types that the human renderers read, so the rename must land as one atomic codemod (D1); and the arktype schema is the **source of truth** the result types derive from, so the schema foundation lands once (D2) and each command then composes it. D3–D7 are per-command and independent of each other (each builds on D2, not on its predecessor) — kept sequential only because the harness has no subagent resume. D8 is the cross-command lock. Tests precede implementation in every dispatch. Standard gate unless noted: `pnpm --filter @prisma-next/cli typecheck` + the touched command's tests + `pnpm lint:deps`.

### Dispatch 1: Rename the shared migration vocabulary (atomic codemod)

- **Outcome:** across the shared types and every reader, `dirName → name`, `spaceId → space`, `from/to → fromContract/toContract` (and `markerHash/targetHash → currentContract/targetContract` in the status types). `migration-list-types.ts`, the status result types, and **all** human renderers that read these fields (`migration-list-render`, `migration-graph-tree-render`/`-space-render`, `migration-status-overlay`, `migration-log-table`) are updated in one change; the package typechecks; existing unit tests are updated to the new field names. No structural/shape change yet — pure rename. Field names are still defined by the current hand-written interfaces.
- **Builds on:** the spec.
- **Hands to:** the renamed migration-entry vocabulary, compiling, with renderers intact.
- **Focus:** the rename only. Not the arktype schemas (D2), not graph nesting (D3), not log/check/status/show structural changes (D4–D7). This is a mechanical fan-out — one outcome ("the vocabulary is renamed and everything compiles"), verified by typecheck + the touched tests.

### Dispatch 2: arktype schema foundation + `list` on it

- **Outcome:** a co-located, exported module of shared arktype sub-schemas — `migrationEntry` (`{ name, hash, fromContract, toContract, operationCount, createdAt, refs, providedInvariants }`), `contractRef` (`{ hash, refs }`), and the `{ ok, summary }` envelope base. The shared result types are **derived** from these schemas (`typeof Schema.infer`), replacing the hand-written interfaces (same field names from D1, so renderers are untouched). `migration list` builds its `--json` against the derived type and its golden test validates the real output against the exported schema. This establishes the pattern (schema → derived type → command emits → test validates) the other commands follow.
- **Builds on:** D1's renamed vocabulary.
- **Hands to:** the shared arktype sub-schemas + the schema-as-source-of-truth pattern, demonstrated end-to-end on `list`.
- **Focus:** the shared schema module + list. Not the other five commands' schemas (they compose this in D3–D7).

### Dispatch 3: `graph` — nested per space, `contracts` + `migrations`

- **Outcome:** `graph --json` changes from flat global `{ nodes, edges }` to `{ ok, spaces: [{ space, contracts: [{hash,refs}], migrations: […] }], summary }`, reusing the per-space enumeration `list`/`status` already use (`aggregate.space(id).graph()`); co-located arktype schema (composing D2's `contractRef` + migration sub-shape); graph golden/parity JSON updated and validated against the schema; the graph human renderer still works.
- **Builds on:** D2 (shared sub-schemas).
- **Hands to:** `graph --json` nested-per-space and schema-locked.
- **Focus:** graph's JSON construction + schema. The one real structural change in the slice.

### Dispatch 4: `status` — `currentContract`/`targetContract` + structured diagnostics

- **Outcome:** `status --json` uses `currentContract`/`targetContract` per space (rename from D1 carried into the JSON), and its `diagnostics` + former `missingInvariantsLine` become structured objects (`{ code, …, message }`; missing-invariants → `{ ref, invariants: [] }`) rather than prose; co-located arktype schema (composing D2's migration entry + the `status` field); status tests updated + validated.
- **Builds on:** D2; D1 (the marker/target rename).
- **Hands to:** `status --json` structured + schema-locked.
- **Focus:** status diagnostics structuring + schema. Not the tree rendering layout.

### Dispatch 5: `log` — ledger `records` + schema

- **Outcome:** `log --json` renames `entries → records`; `SerializedLedgerEntryRecord` fields align to the shared vocabulary (`migrationName → name`, `from/to → fromContract/toContract`, keep `space`/`appliedAt`/`operationCount`/`hash`); the log table renderer reads the renamed fields; co-located arktype schema; log golden/tests updated + validated.
- **Builds on:** D2.
- **Hands to:** `log --json` on `records` + schema-locked.
- **Focus:** log records + the log table renderer reads.

### Dispatch 6: `show` — trim + schema

- **Outcome:** `show --json` drops `migration.dirPath` and the inner per-migration `summary` (replaced by the top-level `summary`); the migration object uses the shared vocabulary + `operations` + `preview: { statements }`; co-located arktype schema (noting `preview` is family-shaped); show tests updated + validated.
- **Builds on:** D2.
- **Hands to:** `show --json` trimmed + schema-locked.
- **Focus:** show's single-migration shape + schema.

### Dispatch 7: `check` — error-envelope vocabulary + `space`

- **Outcome:** `check` failures become `{ space, code, where, why, fix }` (`pnCode → code`, add `space`), aligned to the shared error-envelope vocabulary (`integrity-violation-to-check-failure.ts` updated); co-located arktype schema that models check's two `ok:false` bodies (the `{ failures, summary }` outcome vs the shared error envelope) distinguishably; check tests updated + validated.
- **Builds on:** D2.
- **Hands to:** `check --json` on the error-envelope vocabulary + schema-locked.
- **Focus:** check failure shape + the `ok:false`-outcome-vs-error-envelope distinction.

### Dispatch 8: cross-command consistency lock (parity test)

- **Outcome:** `migration-read-commands-parity.test.ts` is extended to assert, across all six verbs: each `--json` output validates against its exported arktype schema; the shared field names (`name`, `space`, `hash`, `fromContract`/`toContract`) are used identically wherever they appear; the `ok`-mirrors-exit-code rule holds; the nested-vs-flat space-topology rule holds. A regression that reintroduces an old field name or shape fails this test.
- **Builds on:** the cumulative end state of D2–D7 (non-linear: asserts all of them).
- **Hands to:** slice-DoD met — the redesigned, schema-locked shapes are consistent and regression-protected.
- **Focus:** the parity/consistency assertions. No production change; a failure here means the defect is in the corresponding earlier dispatch.
