# Dispatch plan — application-read-surface (TML-2852)

Slice spec: [`./spec.md`](./spec.md). Three dispatches, one per surface — typed I/O, the
`db.enums` runtime surface, and Postgres declaration-order `ORDER BY`. They share **no
hand-off**: each builds independently on slice 1 (merged), so order is for review
coherence, not dependency. Executed D1 → D3; **D3 carries the slice-wide additivity
gate**. The slice-DoD is the union of all three (type-tests in both lanes + `db.enums`
runtime tests + the ORDER-BY integration test). All additive/dark — no fixture is
authored with `enumType`, so `fixtures:check` stays zero-diff. Implementer tier:
sonnet-mid; reviewer: opus.

### Dispatch 1: value-union typing — narrow enum I/O (R4, R5)

- **Outcome:** An `enumType`-authored field's read **output** and write **input** are
  statically the enum's value union (e.g. `'user' | 'admin'`), not `string`, in **both**
  the ORM and query-builder lanes. Type-tests assert the literal tuple survives each hop
  (`enumType` const-generics → authored `Definition` → `FieldOutputType` → query I/O) and
  that an out-of-union write literal is a compile error.
- **Builds on:** Slice 1 (merged) — the domain `enum` entity, the field/column `valueSet`
  ref, and `enumType`'s literal-preserving handle; the spec's chosen design. Independent
  of D2/D3.
- **Hands to:** A typed-contract surface where enum fields carry their value union — the
  narrowing both lanes inherit through the emitted `FieldOutputTypes` TypeMap.
- **Focus:** `FieldOutputType` and its write-input counterpart in
  `contract-ts/src/contract-types.ts` — resolve the field/column `valueSet` to the
  referenced enum's value tuple **in the authored `Definition`** (literals preserved; not
  emitted JSON, which widens to `string[]` — spec open question 2) and narrow the codec
  `string` to that union; nullable stays `… | null`. Type-tests (`*.test-d.ts`) in
  contract-ts and in the ORM + query-builder lanes; fall back to per-lane
  `ComputeColumnJsType` / `ExtractOutputType` only if a lane bypasses `FieldOutputTypes`.
  The literal-propagation lookup is the design-risk — an `expectTypeOf` per hop localizes
  any widening. **Out:** runtime `db.enums` (D2), ORDER BY (D3).

### Dispatch 2: `db.enums.<Name>` runtime surface (R6)

- **Outcome:** `db.enums.<Name>` resolves at runtime and the type level, exposing
  `.values` (ordered literal tuple), `.members.<Name>` → the member **value**, `.names`,
  `.has`, `.nameOf`, `.ordinalOf`, built from the contract's domain `enum` entity. Runtime
  tests cover the accessors; a type-test asserts the literal `values` tuple does not widen.
- **Builds on:** Slice 1 — the domain `enum` entity (ordered `{ name, value }` members)
  and `enumType`'s handle deriving these accessors; the spec's chosen design. Independent
  of D1/D3.
- **Hands to:** A client-side enum introspection surface — the first IR-entity accessor
  map on `db` (the `table.columns.x` precedent), shaped for non-breaking generalization.
- **Focus:** the ORM-client Proxy (`sql-orm-client/src/orm.ts`, ~line 56) — add an `enums`
  branch resolving `db.enums.<Name>` against `contract.domain.namespaces[ns].enum`; a new
  enum-accessor module wrapping a `ContractEnum` into the handle shape (reuse slice-1's
  derivation if exposed, else mirror it). Runtime tests + the literal-tuple type-test.
  **Out:** field-I/O typing (D1), ORDER BY (D3).

### Dispatch 3: declaration-order `ORDER BY` — Postgres (R8) + slice additivity gate

- **Outcome:** `ORDER BY` on an enum column emits
  `array_position(ARRAY[v1, v2, …]::text[], <col>)` from the storage value-set's ordered
  `values` in the Postgres renderer; a PGlite integration test confirms rows sort by
  declaration order (not lexically), including a nullable-column case. **Slice additivity
  gate:** `build → pnpm i → fixtures:check` is byte-identical zero-diff; full
  `pnpm typecheck` clean; `lint:casts` ≤ 0.
- **Builds on:** Slice 1 — the storage value-set's ordered `values` + the column
  `valueSet`; the spec's chosen design. Independent of D1/D2.
- **Hands to:** The slice-DoD — enums sort by declaration order, and the whole slice
  (D1 + D2 + D3) regresses nothing. Closes the slice; hands to the cutover (TML-2853).
- **Focus:** the Postgres `sql-renderer` ORDER BY path
  (`postgres/src/core/sql-renderer.ts`, ~line 194) — intercept a column-ref order item
  whose column carries a `valueSet` and render `array_position(...)` from
  `contract.storage.namespaces[ns].entries.valueSet[name].values`; the bare-column path is
  unchanged otherwise. PGlite integration test (sort + nullable). This dispatch runs the
  final slice-wide additivity / typecheck sweep. **Out:** non-Postgres targets (MySQL
  `FIELD(...)`, SQLite `CASE`) — future.

## Open items (orchestrator-routed; not D1/D2/D3 blockers)

- **Triplicated model/column type-level resolution.** `FindModelForTable` /
  `FindFieldForColumn` (query-builder `selection.ts`, added in D1) duplicate the pair in
  sql-builder `table-proxy.ts`, and relational-core has a third equivalent pair
  (`ExtractTableToModel` / `ExtractColumnToField`). Pre-existing duplication this slice
  extended by one copy; consolidation crosses shared lane layering. Follow-up, not in this
  PR. (Surfaced in the D1 review.)
- **D1 process note:** the implementer's first commit swept stale unrelated worktree files
  (a closed-out project's docs + ADR reverts) via a broad `git add`. The orchestrator
  re-committed D1's files only. Guardrail added to D2/D3 briefs: stage only named files,
  verify `git diff --staged --stat` before committing.
