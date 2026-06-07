# Slice: read-command-json-redesign

_In-project slice. Parent project: `projects/migration-graph-rendering/`. Outcome: the six migration read commands emit consistent, self-describing, agent-facing `--json`, each locked by a co-located exported arktype schema._

## At a glance

Rewrite the `--json` output of `migration list` / `graph` / `status` / `log` / `show` / `check` so the shapes are consistent and the field names are self-describing, and lock each shape with a runtime [arktype](https://arktype.io) schema (co-located with the command, exported on the package surface). This is the durable outcome of the design discussion on 2026-06-05 ([TML-2836](https://linear.app/prisma-company/issue/TML-2836), expanded from "just add schemas" to "redesign + lock"). The commands live in `packages/1-framework/3-tooling/cli/src/commands/migration-*.ts`; the CLI Style Guide § JSON Semantics governs.

**Framing principle (drives every decision):** the JSON's primary reader is AI agents. So each command returns **structured fields as the source of truth, plus a human-readable `summary`**, and errors keep structured `why`/`fix`. A fact a consumer needs is never prose-only; a readable string riding alongside the structured data is welcome.

No external consumers and 0.x semver → the shapes are rewritten freely, with no versioning or migration story.

## Chosen design

### Cross-cutting rules

- **`ok` mirrors the exit code** (`ok === exit 0`). `check` returning `ok: false` when it finds integrity failures is correct — it exits 4. So `ok: false` has **two** bodies: `check`'s `{ ok: false, failures, summary }` (a real outcome at exit 4) and the shared error envelope `{ ok: false, code, why, fix, … }` (exit 1/2). The arktype schemas must admit both, and a consumer disambiguates by presence of `failures` vs `code` (or by exit code).
- **`name`** — a migration's name, everywhere (retires `dirName` and `log`'s `migrationName`). No `path` field for now; `show`'s `dirPath` is dropped (add a `path` later only on real need).
- **`space`** — the contract-space id, everywhere (retires `spaceId`).
- **Self-describing hashes:** a migration's contract endpoints are `fromContract` / `toContract` (`fromContract: null` for the empty start); the migration's own id is plain `hash`; `status`'s `markerHash` / `targetHash` become `currentContract` / `targetContract`; graph contracts are `{ hash, refs }`.
- **`summary`** stays on every command and is reworded to a consistent tone (today the strings are ad hoc).
- **Space topology — nested vs flat by whether the command carries per-space state:**
  - **Nested** under `spaces[]` (the command holds per-space state): `list`, `graph` (per-space contracts+migrations), `status` (per-space current/target contract).
  - **Flat** array, each item tagged with `space` (the command is a stream): `log` records, `check` failures.
  - **Single** item with a `space` field: `show`.

### Per-command target shapes

```jsonc
// list
{ "ok": true, "summary": "…",
  "spaces": [ { "space": "app",
    "migrations": [ { "name": "…", "hash": "sha256:…", "fromContract": null, "toContract": "sha256:…",
      "operationCount": 1, "createdAt": "…", "refs": [], "providedInvariants": [] } ] } ] }

// graph  (structural change: today's flat global nodes/edges → nested per space)
{ "ok": true, "summary": "…",
  "spaces": [ { "space": "app",
    "contracts": [ { "hash": "sha256:…", "refs": ["main"] } ],
    "migrations": [ { "name": "…", "hash": "sha256:…", "fromContract": "sha256:…", "toContract": "sha256:…" } ] } ] }

// status
{ "ok": true, "summary": "…",
  "spaces": [ { "space": "app", "currentContract": "sha256:…", "targetContract": "sha256:…",
    "migrations": [ { "name": "…", "hash": "…", "fromContract": "…", "toContract": "…",
      "operationCount": 1, "createdAt": "…", "refs": [], "providedInvariants": [],
      "status": "applied" } ] } ],
  "diagnostics": [ { "code": "…", "message": "…" } ] }

// log  (entries → records; ledger apply events, not migration definitions)
{ "ok": true, "summary": "…",
  "records": [ { "space": "app", "name": "…", "hash": "sha256:…",
    "fromContract": "sha256:…", "toContract": "sha256:…", "appliedAt": "…", "operationCount": 1 } ] }

// show  (single item; dirPath + inner summary removed)
{ "ok": true, "summary": "…",
  "migration": { "space": "app", "name": "…", "hash": "sha256:…", "fromContract": null, "toContract": "sha256:…",
    "createdAt": "…", "operations": [ { "id": "…", "label": "…", "operationClass": "additive" } ],
    "preview": { "statements": ["…"] } } }

// check  (failures take the error-envelope vocabulary + space)
{ "ok": false, "summary": "…",
  "failures": [ { "space": "app", "code": "PN-MIG-CHECK-001", "where": "migrations/app/…", "why": "…", "fix": "…" } ] }
```

`status` migration entries carry every `list` field plus `status: "applied" | "pending" | null`. `status` diagnostics and the old `missingInvariantsLine` become structured objects (`missingInvariants → { ref, invariants: [...] }`), each carrying a `message` for the agent — never a bare prose line. `show.preview` stays `{ statements }` and is family-specific by nature (a document target renders differently). `refs`, `providedInvariants`, `operationCount` (where enumerating) vs full `operations` (in `show`), `createdAt` (authored) vs `appliedAt` (applied), and `operationClass` are kept as-is.

### The schema lock

Each command gets a co-located, exported arktype schema for its `--json` success shape (and `check`'s failure-outcome shape). The exported TypeScript result type is **derived from** the schema (`typeof Schema.infer`) so the command builds output against the same single source of truth. The golden/parity tests validate each command's real `--json` output against its schema, which is the runtime lock that prevents the shape and the schema drifting apart.

## Coherence rationale

One PR. The change is a single uniform sweep — the same renames and the same envelope rules applied across six sibling commands, plus their schemas and tests. Reviewing them together is the *only* way to judge the thing the slice is for ("are the six now consistent"); splitting shapes from schemas would re-touch every command file twice and let the schema drift from the shape it is supposed to pin. Large but coherent, and rollback-able as one unit. (Sizing was considered for a 2-slice split — shapes then schemas — and rejected for the re-touch + drift cost and the repo's preference for fewer, larger PRs.)

## Scope

**In:** the six commands' `if (flags.json)` construction + their exported result types (`migration-*.ts`); `migration-list-types.ts`, `migration-log-table.ts` (`SerializedLedgerEntryRecord` + `serializeLedgerEntriesForJson` → records), `integrity-violation-to-check-failure.ts` (`CheckFailure` → error-envelope vocab); the per-command arktype schemas (new); the human renderers that read the renamed fields (`migration-list-render`, `migration-graph-tree-render`/space-render, `migration-status-overlay`, `migration-log-table`); the golden + parity tests (`read-commands-json-golden`, `migration-list-json-golden`, `migration-read-commands-parity`).

**Out:** the shared error envelope itself (we align `check` *to* it, not change it); the human (non-json) rendered *layout* (only field-name reads change, not the visual design — that was TML-2801's work); the commands' behaviour/flags (no new flags, no resolution changes); anything outside the six read verbs.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Field renames ripple into the human renderers | In scope, expected | The result-type fields (`dirName`/`spaceId`/`from`/`to`/`markerHash`) are read by the tree/list/log renderers, not only the JSON path. Renaming the types touches those reads. Keep the rendered *layout* identical; only the field access changes. This is the largest non-obvious surface. |
| `graph` flat → nested-per-space | In scope, the one real structural change | Today graph builds global `nodes`/`edges`; the per-space form reuses the same per-space enumeration `list`/`status` already use (`aggregate.space(id).graph()`). Verify multi-space and single-space-elided fixtures still render and serialize. |
| `check` `ok:false` is an outcome, not an error envelope | Schema must model both | A consumer branching on `ok:false` must distinguish check's `{ failures }` from the error envelope `{ code }`. The schemas encode this; a parity test asserts the two are distinguishable. |
| `show.preview` is SQL-shaped | Accept, document | `{ statements }` is family-specific; not normalised across targets in this slice. |

## Slice-specific done conditions

- [ ] Every read command's `--json` matches its target shape above and validates against its co-located exported arktype schema (golden/parity tests assert real output parses); the human (non-json) output still renders correctly after the field renames.

## Open Questions

1. **Runtime self-validation.** Working position: the command builds output against the schema-derived type (compile-time), and the *tests* validate real output against the schema; the command does **not** re-validate its own output on every invocation (avoids per-call cost/noise). Revisit only if an agent-facing guarantee needs runtime enforcement.
2. **`status` diagnostic variants.** Working position: model the existing diagnostic kinds as a discriminated arktype union with a shared `{ code, message }` base; exact variant set pinned at implementation time from the current `StatusDiagnostic` producers.

## Required-section notes

- **Contract-impact:** none (no change to `packages/0-shared/contract/**` or framework-core; `LedgerEntryRecord` in `contract/src/types.ts` is the internal record — only the CLI's *serialized* form changes).
- **Adapter-impact:** the JSON is target-agnostic except `show.preview` (`{ statements }`), which is family-shaped by nature — noted, not normalised here. No per-adapter code changes.
- **ADR:** none. Governed by `docs/CLI Style Guide.md § JSON Semantics`; the agent-facing-JSON framing could be recorded there as part of the slice if it proves worth stating once.

## References

- Parent project: [`projects/migration-graph-rendering/spec.md`](../../spec.md)
- Prior slices: [`../read-command-consistency/spec.md`](../read-command-consistency/spec.md) (TML-2801 — unified the envelopes this redesigns), [`../check-single-target-multi-space/spec.md`](../check-single-target-multi-space/spec.md) (TML-2835)
- Linear issue: [TML-2836](https://linear.app/prisma-company/issue/TML-2836)
- Standard: [`docs/CLI Style Guide.md`](../../../../docs/CLI%20Style%20Guide.md) § JSON Semantics, § Errors
- Surfaces: `migration-{list,graph,status,log,show,check}.ts`; `migration-list-types.ts`; `migration-log-table.ts`; `integrity-violation-to-check-failure.ts`
