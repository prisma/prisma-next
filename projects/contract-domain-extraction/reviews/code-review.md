# Code Review — M4: Remove Old Type Fields

**Branch:** `tml-2180-remove-old-type-fields-m4`
**Base:** `main`
**Spec:** [projects/contract-domain-extraction/spec.md](../spec.md) — Phase 4
**Plan:** [projects/contract-domain-extraction/plan.md](../plan.md) — Milestone 4
**Commit range:** `origin/main..HEAD` (30 commits)

## Summary

This branch removes the backward-compatibility shim from `validateContract()` and the old type fields (`mappings`, top-level `relations`, old `model.fields` shape) from `SqlContract`. It also removes the `TModels` generic parameter from `ContractBase`, the `BuildRelations`/`ExtractModelRelations` dead code, and the dual-format JSON detection logic from `normalizeContract()`.

All issues from review rounds 1–6 are resolved. M4 acceptance criteria are fully met.

## What Looks Solid

- **Type cleanup is thorough.** `SqlContract` no longer carries `R` (relations) or `Map` (mappings) type parameters. `ContractBase` has a concrete `models: Record<string, DomainModel>` instead of a `TModels` generic.
- **Emitter generation cleaned up.** `generateRelationsType()` and `generateMappingsType()` removed from the SQL emitter hook. Generated `contract.d.ts` no longer includes `Relations`, `Mappings`, or old model field types.
- **Dual-format detection removed (task 4.5).** `detectFormat()`, `enrichOldFormatModels()`, and `enrichNewFormatModels()` are gone from `normalizeContract()`.
- **Dead code removed.** `BuildRelations`, `ExtractModelRelations`, `SqlMappings`, `ModelDefinition`, `ModelField` types deleted.
- **ORM client casts cleaned up (task 4.6.1).** `modelOf()` helper replaces the `as Record<string, ...>` casts that were added during M2.
- **Model-to-storage cross-validation added.** New `validateModelStorageReferences()` function verifies model storage references against actual table/column definitions.
- **Strict schema restored.** `SqlContractSchema` has `'+': 'reject'` with `'relations?'` and `'mappings?'` removed — unknown top-level keys are rejected.
- **`normalizeContract()` strips unknown fields generically.** Constructs from known fields only using a `pick` helper — no hardcoded list of legacy keys.
- **Inline test contracts properly updated.** Contracts in `*.test.ts` files across all packages were updated across several commits.
- **Parity fixtures updated.** All 12 parity expected contract JSON files properly regenerated.
- **Demo and authoring fixtures updated.** Demo `contract.json`, `contract-with-relations.json`, and three `.d.ts` fixtures all updated to current schema.
- **`canonicalizeContract()` aligned.** No longer serializes `ir.relations`; constructs from known fields only.
- **Emitter enforces relation `on` shape.** `generateModelRelationsType` now throws when `on` is present but missing `localFields`/`targetFields` instead of silently dropping.

## Resolved Issues (Review Round 6)

| ID | Issue | Resolution |
|---|---|---|
| F01-R6 | `basic-contract.json` fixture uses stale schema (`"extensions"`, `"type"`, missing `capabilities`) | **Fixed** — updated to current schema (`extensionPacks`, `nativeType`+`codecId`, `capabilities`) |
| F02-R6 | JSON schemas use `"extensions"` not `"extensionPacks"` | **Fixed** — both schemas renamed to `extensionPacks` |
| F03-R6 | Normalization test inputs use old-format domain fields and relation `on` | **Fixed** — test inputs updated to current shapes |

## Resolved Issues (Review Round 5)

| ID | Issue | Resolution |
|---|---|---|
| F01-R5 | Four stale JSON fixtures (old field shapes, `"extensions"`, top-level `relations`) | **Fixed** — all 4 fixtures updated to current schema (`extensionPacks`, `codecId`/`nullable`, no top-level `relations`) |
| F02-R5 | JSON schema description misleading for domain `fields` | **Fixed** — description now reads "Domain field metadata (codecId, nullable)" |
| F03-R5 | Emitter silently drops relations without `localFields`/`targetFields` | **Fixed** — now throws `Relation "X" has an "on" block but is missing localFields or targetFields` |
| F09-R3 | Migration `emit.ts` has old→new field transform (`toDomainModel`) | **Resolved** — function no longer exists in `emit.ts`; no old→new transform present |

## Not in M4 Scope

- **`ContractIR` top-level `relations`** — The IR type, `contractIR()` factory, and IR-level tests still support top-level `relations`. This is explicitly M5 scope (plan task 5.2: "Update ContractIR to mirror the ADR 172 structure... no top-level relations or mappings").
- **Stale documentation** (ADRs, subsystem docs, planning docs referencing top-level `relations`/`mappings`) — Can be updated alongside M5 or separately.
- **Builder internal `parentCols`/`childCols` naming** — The framework builder uses old naming internally (`builder-state.ts`, `model-builder.ts`), but the output is correctly translated to `localFields`/`targetFields` in `contract-builder.ts`. Being replaced in another branch.
- **Core validator relation `on` enforcement** — The core `validateContract()` doesn't validate relation `on` shapes; only the authoring-layer `validateContractLogic` in `contract-ts` does. This is a validation-hardening concern, not old-field removal. The shared domain validation extraction (spec Phase 1, task 1.2) is the appropriate place for this.

## Resolved Findings (Review Round 3)

| ID | Issue | Status |
|---|---|---|
| F01-R3 | SQL emitter fallback produces old `{ column }` model field shape | **False positive** — `{ readonly column }` is in `storageFieldParts` (storage section), not domain `fields`. Domain fallback correctly emits `unknown`. |
| F02-R3 | ORM `FieldJsType` has compat guard for old field shape | **Resolved** — old `extends { readonly column: string }` branch is gone. `FieldJsType` now falls back to `unknown` via `FieldStorageJsType`. |
| F03-R3 | Emitter tests assert old fallback behavior | **False positive** — tests assert `readonly email: unknown` and `readonly id: unknown` for fallback cases, not old `{ column }` shape. |
| F04-R3 | `validateContractLogic` silently skips FK check on `parentCols`/`childCols` | **Resolved** — now throws `"uses unsupported relation format (expected localFields/targetFields)"` when `localFields`/`targetFields` are missing. |
| F05-R3 | JSON schema allows both old and new relation `on` field naming | **Resolved** — `parentCols`/`childCols` removed from JSON schema; only `localFields`/`targetFields` remain. |
| F06-R3 | Migration fixtures have top-level `relations` and `mappings` | **False positive** — `"relations": {}` in migration fixtures is model-level (nested under `models.X`), not top-level. No top-level `relations` or `mappings` on `toContract`/`fromContract`. |
| F07-R3 | `MongoContractSchema` allows top-level `relations` | **Resolved** — `'relations?'` removed from `MongoContractSchema`; `'+': 'reject'` rejects unknown top-level keys. |
| F08-R3 | Mongo demo and test fixtures have top-level `relations` | **Resolved** — Mongo demo `contract.json`, `generate-contract.ts`, `blog-contract-ir.ts`, and `create-mongo-ir.ts` all use model-level relations only; no top-level `relations`. |
| F10-R3 | Stale `createTestContract` JSDoc mentioning `mappings` | **Resolved** — stale comment removed. |

## Resolved Findings (Review Rounds 1 & 2)

<details>
<summary>Click to expand resolved findings from prior review rounds</summary>

### Review Round 2

| ID | Issue | Status |
|---|---|---|
| F01-R2 | `normalizeContract()` leaks legacy top-level fields to strict validator | **Resolved** — constructs from known fields only using `pick` helper |
| F02-R2 | Demo `contract.json` not regenerated | **Resolved** — regenerated, no top-level `relations`/`mappings` |
| F03-R2 | `contract-with-relations.json` fixture has top-level `relations` and `mappings` | **Resolved** — updated to current schema |
| F04-R2 | Three `contract.d.ts` fixtures have stale `SqlContract` generics | **Resolved** — updated to 2-parameter layout |
| F05-R2 | `canonicalizeContract()` still serializes `ir.relations` | **Resolved** — constructs from known fields only |
| F06-R2 | PSL interpreter README stale reference | **Resolved** — now reads `models.<Model>.relations` |

### Review Round 1

| ID | Issue | Status |
|---|---|---|
| F01-R1 | Model-to-storage cross-validation deleted from `validateContract()` | **Resolved** — new `validateModelStorageReferences()` added |
| F02-R1 | Structural validator dropped strict mode (`'+': 'reject'`) | **Resolved** — restored |
| F03-R1 | `BuildModels` produces `fields: Record<string, never>` | **Resolved** — updated to `DomainModel` shape |
| F04-R1 | Contract builder still produces top-level `relations` | **Resolved** — `relationsPartial` removed |
| F05-R1 | `controlInstance` strips top-level relations via unsafe double cast | **Resolved** — simplified |
| F06-R1 | `BuildRelations` and `ExtractModelRelations` are dead code | **Resolved** — deleted |

</details>

## Acceptance-Criteria Traceability

### Phase 4 from spec

| Acceptance Criterion | Status | Evidence |
|---|---|---|
| `mappings` removed from `SqlContract` and `validateContract()` derivation logic | **Done** | Type removed; `SqlMappings` deleted; no derivation in `constructContract()` |
| Top-level `relations` removed from `SqlContract` and `validateContract()` | **Done** | SQL and Mongo schemas cleaned; `normalizeContract()` strips unknown fields; all fixtures updated |
| Old model field shape (`{ column: string }`) removed from the type | **Done** | Type removed from `SqlContract`; emitter domain fallback emits `unknown`; ORM compat guard removed |
| `contract.d.ts` emission reflects the final shape (no old fields) | **Done** | Main path emits `codecId`/`nullable`; fallback emits `unknown`; `{ column }` only in storage section (correct) |
| All fallback / old-format tolerance removed | **Done** | `normalizeContract` dual-format removed; `validateContractLogic` throws on `parentCols`/`childCols`; JSON schema only allows `localFields`/`targetFields`; emitter throws on invalid relation `on` |
| All test fixtures updated | **Done** | All fixtures updated to current schema |

### Plan tasks (4.1–4.8)

| Task | Status | Notes |
|---|---|---|
| 4.1 Remove mappings from `SqlContract` | **Done** | |
| 4.2 Remove top-level relations from `SqlContract` | **Done** | SQL and Mongo schemas aligned |
| 4.3 Remove old model field shape | **Done** | Type removed; emitter and ORM updated |
| 4.4 Update `contract.d.ts` emission | **Done** | |
| 4.5 Remove old-format JSON from `normalizeContract()` | **Done** | Dual-format detection removed; normalizer constructs from known fields only |
| 4.6 Remove `TModels` from `ContractBase` | **Done** | Concrete `Record<string, DomainModel>` |
| 4.6.1 Remove `as Record<string, ...>` casts | **Done** | `modelOf()` helper |
| 4.7 Update all test fixtures | **Done** | All fixtures updated |
| 4.8 Run full test suite and typecheck | **Done** | All pass (see below) |

## Test Results

Review Round 6 (current):

```
pnpm typecheck:packages     → 85/85 passed ✅
pnpm test:packages          → 77/77 passed ✅ (transient sql-builder failure passes on re-run)
pnpm test:examples          → 42/42 passed ✅
```

All findings from rounds 1–6 resolved. All M4 acceptance criteria met.
