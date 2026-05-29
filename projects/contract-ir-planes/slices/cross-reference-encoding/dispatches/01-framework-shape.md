# D1 — Framework cross-reference shape + `NamespaceId` brand + validators + family serializer hydration

> **Brief format & scope discipline.** Land the framework-level encoding shape change (object-pair cross-references), the `NamespaceId` brand, validator schemas for the new shape (SQL + Mongo), and the family serializer hydration / round-trip path. **Do not** touch authoring lowering (D2), emitter typegen (D2), fixture regen (D3), planner / schema-IR consumers (D2 / S1.E), or codec-alias domain population (D2). Stay strictly within the file surfaces enumerated below; the grep pre-flight (step 1) bounds the edit set — surprises halt the dispatch. **Do not** introduce any transitional dual-shape `to: string | { namespace, model }` union; the shape is one-way.
>
> **Slice spec:** [`projects/contract-ir-planes/slices/cross-reference-encoding/spec.md`](../spec.md). **Slice plan:** [`projects/contract-ir-planes/slices/cross-reference-encoding/plan.md`](../plan.md) § Dispatch 1. **Subsumed cleanup:** [TML-2586](https://linear.app/prisma-company/issue/TML-2586) (FK `references.schema` typed as `NamespaceId`). **Linear:** [TML-2624](https://linear.app/prisma-company/issue/TML-2624)[^1].

[^1]: [TML-2624](https://linear.app/prisma-company/issue/TML-2624) was canceled on 2026-05-20 along with the other slice tracking tickets (TML-2622 / S1.A, TML-2623 / S1.B); the operator tracks via the parent project ticket ([TML-2584](https://linear.app/prisma-company/issue/TML-2584)). PR titles continue to prefix the slice-ticket id for traceability.

## Why this dispatch exists

S1.A landed the framework substrate (two-plane `Contract<{domain?, storage}>` type, narrowed `Namespace`, `elementCoordinates(storage)`, descriptor mechanism). S1.B migrated Postgres enum off the framework-shared namespace `types` slot. The next structural move (PDoD4) is the cross-reference encoding: `relation.to`, `model.base`, `roots[*]`, and FK references all carry `{ namespace, model }` (or `{ namespaceId, tableName, columns }` for storage-plane refs) on the wire, with a single shared `NamespaceId` brand.

D1 lands the **shape contract** every other dispatch (D2 producers/consumers, D3 fixtures) keys off. After D1: the framework cross-reference types exist; the SQL + Mongo validators accept the new envelope; the SQL + Mongo family serializer hydration paths round-trip the new shape; the FK reference and Postgres `ForeignKeySpec` consume the `NamespaceId` brand. After D1: authoring DSLs still emit bare-string `to` (D2 fixes); emitted `.d.ts` still renders bare-string `to` (D2 fixes); fixtures on disk still carry bare-string `to` (D3 regens).

`pnpm test:integration` and `pnpm fixtures:check` will fail after D1 commits — that is **expected**, not a defect. D2 fixes producers + consumers; D3 regens fixtures. Don't rework D1 on an integration / fixtures failure unless it surfaces a structural defect in the shape contract itself.

## Settled decisions (don't re-question)

Four design decisions are pre-locked. Each carries the chosen shape, the rationale, and the rejected alternative — implementers MUST NOT re-litigate without escalating.

### Decision A — `NamespaceId` brand representation

**Choice: structural-only string brand.** The brand is a type-system tightening (e.g. `export type NamespaceId = string & { readonly __brand: 'NamespaceId' }`) declared at the framework foundation; runtime values are still plain strings. arktype validates a `NamespaceId` field with `'string'`.

**Rationale.** Minimal surface area; matches existing `namespace.id: string` typing on the framework `Namespace` interface that S1.A landed (no asymmetry between `Namespace.id` and cross-ref `namespace` values at runtime). The brand carries the *coordinate axis* at compile time without buying any runtime parsing cost. arktype's `'string'` validator already enforces the runtime invariant the brand encodes.

**Rejected: arktype-tagged brand.** Would require the brand to flow through `arktype-json` consumers downstream (every cross-ref parse incurs an extra narrow step) and adds runtime cost for zero correctness gain at D1's boundaries — the brand isn't checked against any registry at validate-time (`NamespaceId` isn't a registry-bounded type the way `CodecId` is in some pack contracts). If a downstream consumer surfaces who'd benefit from runtime tagging (e.g. a future cross-namespace authoring sanity check that validates against a known-namespace set), escalate at that time; D1's surface doesn't justify it.

### Decision B — Cross-reference type shape

**Choice: a single shared cross-reference type used by `relation.to`, `model.base`, `roots[*]`, AND `ForeignKeySpec.references` (the TML-2586 subsumed shape).** Declared at the framework foundation. Concrete shape:

```ts
// Domain-plane cross-references: relation.to / model.base / roots[*]
export interface CrossReference {
  readonly namespace: NamespaceId;
  readonly model: string;
}
```

The storage-plane FK reference (`ForeignKeyReference` at [`packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts), already shipped as `{ namespaceId, tableName, columns }` by PR #534) is a **distinct** type because it addresses tables (carries `columns`) and uses storage-plane vocabulary (`namespaceId` / `tableName`). The asymmetry is intentional and load-bearing — ADR Decision 4 § "Cross-references encoded as object pairs" explicitly distinguishes the two shapes. D1 unifies the `namespace` axis under the `NamespaceId` brand (FK's `namespaceId: NamespaceId`; CrossReference's `namespace: NamespaceId`) but keeps the two shape declarations separate.

The single domain-side `CrossReference` covers four call sites:

| Call site | Field | Today | After D1 |
|---|---|---|---|
| `ContractReferenceRelation.to` ([`domain-types.ts:32`](../../../../../packages/1-framework/0-foundation/contract/src/domain-types.ts)) | `to` | `string` | `CrossReference` |
| `ContractEmbedRelation.to` ([`domain-types.ts:38`](../../../../../packages/1-framework/0-foundation/contract/src/domain-types.ts)) | `to` | `string` | `CrossReference` |
| `ContractModelBase.base` ([`domain-types.ts:64`](../../../../../packages/1-framework/0-foundation/contract/src/domain-types.ts)) | `base` | `string` (optional) | `CrossReference` (optional) |
| `Contract.roots` ([`contract-types.ts:46`](../../../../../packages/1-framework/0-foundation/contract/src/contract-types.ts)) | `roots` | `Record<string, string>` | `Record<string, CrossReference>` |

**Rationale.** One validator fragment, one hydration pass-through, one composer to touch for future refinements. The four call sites all address the same *kind* of entity (a model in some namespace); reusing the type collapses the encoding decision to a single point of edit.

**Rejected: per-field bespoke types** (`RelationTargetRef`, `BaseModelRef`, `RootRef`). Leaks the encoding decision across four declaration sites; every future tweak (e.g. adding an optional `version` tag to address evolving models) requires four edits and four validator changes. The slice spec § Approach pinned the single-type shape; D1 implements it.

### Decision C — Optionality of `namespace` field

**Choice: required.** Every cross-reference always carries both `namespace` and `model`. No `namespace?` optional. No implicit same-namespace resolution at the IR / wire shape.

**Audit finding.** The slice spec spelled the working position as required-no-implicit; D1 brief assembly confirmed via grep that the current encoding is bare-string everywhere (`relation.to: "User"`) — there is no existing implicit-same-namespace resolution code at the framework IR / validator layer that survives the change. The only resolution happens at *authoring time* in the SQL / Mongo lowering paths (D2 scope), which already carries the model→namespace map and can produce the explicit pair without a fallback. PR #534's FK shape (`{ namespaceId, tableName, columns }`) likewise required both fields from the start; D1 generalises the precedent.

**Rationale.** ADR Decision 4 rejected implicit same-namespace + explicit-override on the grounds that asymmetric shapes force every consumer to handle both variants. S1.E's surface confirms the cost — implicit-resolution code paths shipped as silent collisions when two namespaces hold same-named entities. D1 enforces explicit-always at the framework type so no consumer can re-introduce the asymmetry.

**Rejected: optional `namespace` with fallback to outer model's namespace.** Re-introduces the implicit-resolution branch S1.E is fixing on the planner side and ADR D4 explicitly rejected. The cost of explicit-always at authoring time is one map lookup per cross-reference; the cost of implicit-with-fallback is per-consumer fallback code + silent collision exposure.

### Decision D — Document-scoped vs namespace-scoped IR location

**Choice: cross-references are properties of relations / models / roots — they live wherever those entities live.** A cross-reference *value* (`{ namespace, model }`) is a reference *to* an entity in some namespace; the cross-reference itself sits on the referencing entity (relation, model base, root entry), not in any cross-cutting registry. No new framework-layer table maps cross-references to entities; the populated domain plane (D2/D3) is the lookup surface for resolution. No `crossReferences: Map<…>` field on `Contract`.

**Rationale.** Defensive against confusion only; the cross-reference value is a tuple, not an entity in its own right. Stating it explicitly heads off implementer instinct to "add a registry to track cross-refs" (F6 — Risk #5 (b) failure mode).

## Files in play

Grep pre-flight (step 1 of execution) bounds the inventory; the table below is the working position grounded on the slice spec source-surfaces table + audit done during brief assembly. **Forecast: ~15 files** (above the slice plan's ~12 working ceiling, below the >18 re-decomposition threshold — flag at first commit if cascade exceeds 18).

### Step 1 (pre-flight): grep inventory

```bash
# Cross-reference shape contract — every site that uses string-typed cross-refs at the IR / validator boundary
rg -n 'readonly to:\s*string\b|readonly base\?\:\s*string\b|roots:\s*Record<string,\s*string>' \
   packages/1-framework/0-foundation/contract/src/ \
   packages/2-sql/1-core/contract/src/ \
   packages/2-mongo-family/1-foundation/mongo-contract/src/ \
   --glob '!**/dist/**' --glob '!**/*.json'

# FK reference + Postgres ForeignKeySpec.references.schema (TML-2586 subsumed)
rg -n 'namespaceId:\s*string|references:\s*\{[^}]*schema:\s*string' \
   packages/2-sql/1-core/contract/src/ir/ \
   packages/3-targets/3-targets/postgres/src/core/migrations/operations/
```

Record the file list in the dispatch commit body or PR description appendix. Edits stay within this list; surprises halt the dispatch.

### Step 2 (lockfile + stale-dist pre-flight)

Mandatory pre-flight inheriting from S1.B retros ([`drive/retro/findings.md`](../../../../../drive/retro/findings.md) 2026-05-21 + 2026-05-22 + D2-R2 lockfile-leak):

```bash
pnpm install --frozen-lockfile       # MUST be clean; no test-NNNN-* importers
rm -rf .turbo                        # clear Turbo cache
pnpm build --force                   # full workspace force-build before typecheck
```

If `pnpm install --frozen-lockfile` surfaces drift, halt — do not edit `pnpm-lock.yaml` by hand (per `.cursor/rules/no-direct-lockfile-edits.mdc`). Re-run `pnpm install` to update lockfile + node_modules together, then verify with `--frozen-lockfile`. If still dirty, halt and report.

### Step 3 (edits): surfaces grouped by package

| Surface | Paths | Change |
|---|---|---|
| **New: `NamespaceId` brand** | New file at [`packages/1-framework/0-foundation/contract/src/namespace-id.ts`](../../../../../packages/1-framework/0-foundation/contract/src/namespace-id.ts) | Declare `export type NamespaceId = string & { readonly __brand: 'NamespaceId' }`. Add a runtime-cheap factory `asNamespaceId(value: string): NamespaceId` returning `value as NamespaceId` (no validation — the brand is compile-time). Export via `exports/types.ts`. |
| **New: `CrossReference` type** | New file at [`packages/1-framework/0-foundation/contract/src/cross-reference.ts`](../../../../../packages/1-framework/0-foundation/contract/src/cross-reference.ts) | Declare `export interface CrossReference { readonly namespace: NamespaceId; readonly model: string }` plus its arktype schema (for re-use by SQL + Mongo validators). Export via `exports/types.ts`. |
| **Framework domain types** | [`packages/1-framework/0-foundation/contract/src/domain-types.ts`](../../../../../packages/1-framework/0-foundation/contract/src/domain-types.ts) | `ContractReferenceRelation.to: CrossReference` (was `string`). `ContractEmbedRelation.to: CrossReference` (was `string`). `ContractModelBase.base?: CrossReference` (was `string`). Add `import type { CrossReference } from './cross-reference'`. |
| **Framework contract types** | [`packages/1-framework/0-foundation/contract/src/contract-types.ts`](../../../../../packages/1-framework/0-foundation/contract/src/contract-types.ts) | `Contract.roots: Record<string, CrossReference>` (was `Record<string, string>`). Keep `Contract.domain` as-is (already exists optional from S1.A). **Do not** remove flat `models` / `valueObjects` in D1 — the canonical-shape move is a follow-up consideration; D1's brief settles type contract only. Flag in handoff if D2 surfaces a need to remove flat fields earlier. |
| **Framework domain validator** | [`packages/1-framework/0-foundation/contract/src/validate-domain.ts`](../../../../../packages/1-framework/0-foundation/contract/src/validate-domain.ts) | `DomainContractShape.roots` shape change; `DomainModelShape.base` shape change; `relations.to` shape change. `validateRoots` walks `relation.to.model` (resolves the model name from the pair against the flat models map — D1 keeps the flat models tree as the lookup surface; D2/D3 populate `domain.<ns>.models`, at which point the walker can resolve via the populated plane). `validateRelationTargets` likewise. `validateVariantsAndBases` reads `model.base.model`. **No** namespace-correctness check across the pair yet (the populated domain plane is needed; D2/D3 land it). |
| **Framework canonicalization** | [`packages/1-framework/0-foundation/contract/src/canonicalization.ts`](../../../../../packages/1-framework/0-foundation/contract/src/canonicalization.ts) | Touch only if `roots` serialisation order/key changes (likely yes since values become objects — confirm at brief execution; canonical sort is by root-key string, value sort is object-internal — change should be minimal). |
| **Framework hashing** | [`packages/1-framework/0-foundation/contract/src/hashing.ts`](../../../../../packages/1-framework/0-foundation/contract/src/hashing.ts) | Default `roots: {}` already empty; verify hash-input shape change doesn't crash on test contracts (defaults still satisfy the new type). Likely zero edits beyond a type-check pass. |
| **Framework testing factories** | [`packages/1-framework/0-foundation/contract/src/testing-factories.ts`](../../../../../packages/1-framework/0-foundation/contract/src/testing-factories.ts) | Default `roots: {}` shape; update any helper that constructs a relation / root with a bare-string `to` to use the pair. |
| **Framework exports** | [`packages/1-framework/0-foundation/contract/src/exports/types.ts`](../../../../../packages/1-framework/0-foundation/contract/src/exports/types.ts) | Re-export `NamespaceId`, `asNamespaceId`, `CrossReference`. |
| **SQL family validator** | [`packages/2-sql/1-core/contract/src/validators.ts`](../../../../../packages/2-sql/1-core/contract/src/validators.ts) | Add `CrossReferenceSchema` (`type({ '+': 'reject', namespace: 'string', model: 'string' })`). Change `createSqlContractSchema`'s `'roots?': 'Record<string, string>'` (line 386) to `'roots?': type({ '[string]': CrossReferenceSchema })`. Change `ModelSchema.base?: 'string'` (line 360) to `'base?': CrossReferenceSchema`. Change `ModelSchema.relations?: type({ '[string]': 'unknown' })` (line 357) to compose a relation entry schema that validates `to: CrossReferenceSchema` (tighten the relation schema — fold here since the same file already declares `ModelSchema`; ≤ 15 LoC change). `ForeignKeyReferenceSchema.namespaceId: 'string'` (line 133) — type signature unchanged at arktype level (`'string'`); the consuming TS type tightens to `NamespaceId` (no runtime change). |
| **Mongo family validator** | [`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts`](../../../../../packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts) | `RelationSchema.to: 'string'` (line 48) → `CrossReferenceSchema` (declare locally or import from a shared location — D1 brief decision below). Top-level `roots: 'Record<string, string>'` (line 385) → `Record<string, CrossReferenceSchema>`. `base?` shape on the model schema (grep for the model schema declaration). |
| **Mongo storage validator (consumer)** | [`packages/2-mongo-family/1-foundation/mongo-contract/src/validate-storage.ts`](../../../../../packages/2-mongo-family/1-foundation/mongo-contract/src/validate-storage.ts) | `contract.models[relation.to]` (line 44) → `contract.models[relation.to.model]`. Error messages updated to format the pair (`${relation.to.namespace}.${relation.to.model}`) for human readability. Same flat-models-walk assumption as the framework domain validator: D1's reader walks the still-flat `contract.models` tree using the model name from the pair; D2/D3 populate the domain plane. |
| **SQL FK reference IR (type tightening)** | [`packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts) | `ForeignKeyReferenceInput.namespaceId: NamespaceId` (compile-time). Class field `ForeignKeyReference.namespaceId: NamespaceId`. Add `import type { NamespaceId } from '@prisma-next/contract/types'`. Subsumes [TML-2586](https://linear.app/prisma-company/issue/TML-2586). |
| **Postgres `ForeignKeySpec` (type tightening)** | [`packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts) | `ForeignKeySpec.references.schema: NamespaceId` (line 37). Compile-time only; no on-disk DDL change. Subsumes [TML-2586](https://linear.app/prisma-company/issue/TML-2586) (the postgres-internal counterpart). |
| **SQL family serializer base** | [`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`](../../../../../packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts) | Cross-references on the wire are plain JSON objects; the existing passthrough (lines 108–115) preserves them unchanged through hydration. **Expected zero edits** beyond a typecheck-pass — if a typecheck failure surfaces in the hydration types, narrow the edit to the minimal type-bridging cast and document. If hydration code actively transforms cross-refs (it shouldn't), halt and surface. |
| **Mongo family serializer base** | Grep at brief execution: `rg -l 'class.*ContractSerializer.*Base\|deserializeContract' packages/2-mongo-family/9-family/src/ packages/2-mongo-family/9-family/src/core/ 2>/dev/null` | Same expected-zero-edits as SQL — cross-refs round-trip via passthrough. Confirm at execution; if non-trivial transform exists, halt and surface. |
| **Test updates (pin shape)** | Grep at brief execution: `rg -l 'to:\s*[\\"\\\'][A-Z]' packages/1-framework/0-foundation/contract/test/ packages/2-sql/1-core/contract/test/ packages/2-mongo-family/1-foundation/mongo-contract/test/ --glob '*.test*.ts'` | Update tests that assert bare-string `to` / `base` / `roots` shape to assert the new pair shape. Expected ~2–4 test files. |

### Files explicitly NOT in play

- [`packages/2-sql/2-authoring/`](../../../../../packages/2-sql/2-authoring/), [`packages/2-mongo-family/2-authoring/`](../../../../../packages/2-mongo-family/2-authoring/) — authoring lowering (TS DSL + PSL) is **D2**. Do not change how relations / bases / roots are produced from authoring input.
- [`packages/1-framework/3-tooling/emitter/`](../../../../../packages/1-framework/3-tooling/emitter/), [`packages/2-mongo-family/3-tooling/emitter/`](../../../../../packages/2-mongo-family/3-tooling/emitter/) — emitter typegen is **D2**. Do not change `domain-type-generation.ts`'s relation / base / roots rendering.
- [`packages/3-extensions/sql-orm-client/`](../../../../../packages/3-extensions/sql-orm-client/), [`packages/2-mongo-family/5-query-builders/`](../../../../../packages/2-mongo-family/5-query-builders/), [`packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`](../../../../../packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts) — downstream consumers (ORM, query builder, planner) are **D2**. Their consumer-read updates land alongside the authoring lowering change.
- [`packages/1-framework/1-core/framework-components/src/ir/namespace.ts`](../../../../../packages/1-framework/1-core/framework-components/src/ir/namespace.ts) — `Namespace.id: string` stays `string` in D1. Re-typing `Namespace.id: NamespaceId` is a wider propagation and a follow-up consideration; flag in handoff. Re-typing in D1 would expand the cascade beyond the M-cap.
- `examples/`, `test/fixtures/`, any `contract.json` / `contract.d.ts` — fixture regen is **D3**.
- Any framework-layer cross-reference registry, `crossReferenceTable`, `namespaceIdAllowList`, runtime `NamespaceId` validator — all forbidden by F6 / Decision A.
- Codec-alias relocation to `domain.<ns>.types` — **D2 if absorbed, else D3 fixture regen flushes**.
- S1.E's planner-side namespace-aware enum work — entirely separate slice; S1.C does not touch `column.typeRef` or the planner enum lookups.

## Done when

- [ ] **Lockfile pre-flight:** `pnpm install --frozen-lockfile` clean (no `test-NNNN-*` ephemeral importers, no `@prisma-next/*@0.10.0` published-package refs in `pnpm-lock.yaml`).
- [ ] **Stale-dist pre-flight:** `rm -rf .turbo && pnpm build --force` ran before any `pnpm typecheck`.
- [ ] Pre-flight grep inventory recorded in commit body or PR appendix; edits stayed within that list.
- [ ] Build cascade clean in order: `pnpm --filter @prisma-next/contract build` → `@prisma-next/sql-contract build` → `@prisma-next/mongo-contract build` → `@prisma-next/family-sql build` → `@prisma-next/family-mongo build` → `@prisma-next/target-postgres build` (verify final package names at brief time via `package.json` reads).
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint:deps` clean — no new framework→target or contract→framework-components layering violations (the `NamespaceId` brand and `CrossReference` type live in `0-foundation/contract`; downstream consumers only).
- [ ] `pnpm test:packages` runs; framework + sql-core + sql-family + mongo-foundation tests green. Tests in **other packages** (authoring, emitter, ORM-client, query-builders, integration) may red on the new shape — call those out as known-deferred-to-D2/D3 in the implementer report; **do not patch them in D1**.
- [ ] **Intent-validation grep #1:** `rg 'readonly to:\s*string\b|readonly base\?\:\s*string\b' packages/1-framework/0-foundation/contract/src/ packages/2-sql/1-core/contract/src/ packages/2-mongo-family/1-foundation/mongo-contract/src/ --glob '!**/dist/**' --glob '!**/*.json'` → **zero matches** (shape contract migrated).
- [ ] **Intent-validation grep #2:** `rg 'roots:\s*Record<string,\s*string>' packages/1-framework/0-foundation/contract/src/ packages/2-sql/1-core/contract/src/ packages/2-mongo-family/1-foundation/mongo-contract/src/ --glob '!**/dist/**'` → zero matches.
- [ ] **Intent-validation grep #3:** `NamespaceId` brand declared at `packages/1-framework/0-foundation/contract/src/namespace-id.ts`; `ForeignKeyReference.namespaceId` typed `NamespaceId` (grep at declaration + at `ForeignKeyReferenceInput`); `ForeignKeySpec.references.schema` typed `NamespaceId`.
- [ ] **Intent-validation grep #4:** `rg 'asNamespaceId|NamespaceId\b' packages/1-framework/0-foundation/contract/src/exports/types.ts` confirms exports surface.
- [ ] **Functional gate:** a hand-rolled cross-reference object pair (`{ namespace: asNamespaceId('public'), model: 'User' }`) parses through `CrossReferenceSchema` and round-trips through the SQL family serializer hydration (deserialize → serialize → deep-equal) without loss. Add this as a unit test if not present; one test, ≤ 20 LoC.
- [ ] **Explicit non-gate:** `pnpm test:integration` and `pnpm fixtures:check` are **expected to fail** after D1 commits — do **not** treat fixture / integration drift as D1 rework; proceed to D2.

## Risk #5 (a)+(b) overlay walk

Every surface D1 touches, walked against the two questions:

- **(a)** For every field in any public surface this dispatch touches, what does it add that an existing field doesn't already say?
- **(b)** For every framework-layer data structure that encodes target/family identity, what enforcement does it provide that contract hydration / validation doesn't already structurally provide?

| Surface | (a) — non-redundancy | (b) — enforcement beyond hydration/validation |
|---|---|---|
| **`NamespaceId` structural brand** | Tightens an existing `string` field's type without introducing a new runtime value or field. The brand carries the coordinate-axis semantics at compile time. | Compile-time only — the brand exists in the type system; at runtime the value is still a string. arktype validates `'string'` structurally; no runtime registry, no allow-list, no parse-time check. |
| **`CrossReference { namespace, model }` shared type** | Replaces a bare string at four call sites (`relation.to`, `model.base`, `roots[*]`, plus storage-plane FK shape pattern). The pair *is* the entity coordinate (per FR2 / ADR D6); the bare string lost the namespace axis. No new field beyond the bare string's information — the field shape grows from string to record, but the entity-pointer semantics are identical. | Structural — the validator walks `contract.domain[namespace].models[model]` (or in D1's flat-tree state, `contract.models[model]` keyed by the pair's `model`). No new identity table, no new framework-layer registry. The pair *is* the coordinate the framework already promises to honour. |
| **`ContractReferenceRelation.to: CrossReference`** | Replaces bare string with the canonical coordinate. Same as above — the field shape tightens, not duplicates. | Same — validator resolves the pair against the populated domain plane (or the flat tree in D1's transitional state). No parallel registry. |
| **`ContractEmbedRelation.to: CrossReference`** | Same shape as reference relation — uniform encoding across relation kinds. No bespoke per-kind variant. | Same — structural resolution. |
| **`ContractModelBase.base?: CrossReference`** | Same — STI base reference becomes namespace-explicit. | Same — validator resolves against domain plane. |
| **`Contract.roots: Record<string, CrossReference>`** | Each root maps a root key to a coordinate pair. Replaces the bare-string value with the entity coordinate. **Bonus:** the structural fix fixes the `Contract.roots: Record<string, string>` widening that produces TML-2400's compile-time inference miss (the inference fix itself is a follow-up; the structural correction lands here). | Validator walks the populated domain plane for each root's `(namespace, model)` resolution; no new identity surface. |
| **`ForeignKeyReference.namespaceId: NamespaceId`** | Type tightening of an existing `string` field; no new field, no new data on the wire. | Compile-time brand; runtime unchanged. The existing structural validation (`namespaceId: 'string'` in arktype) stays. |
| **`ForeignKeySpec.references.schema: NamespaceId`** | Same — postgres-internal type tightening. No on-disk DDL change. | Compile-time brand; runtime unchanged. |
| **`CrossReferenceSchema` (arktype) in SQL + Mongo validators** | Validates `{ namespace: 'string', model: 'string' }` with `'+': 'reject'`. Replaces the structural absence of cross-ref-shape validation (the relation `to` was previously unvalidated structurally — `'relations?': type({ '[string]': 'unknown' })`). | Structural — arktype rejects malformed cross-refs at parse time. No registry. No allow-list of namespace values (the brand is compile-time; the validator accepts any string for `namespace` at runtime — runtime cross-ref-namespace-existence is the populated-domain-plane walker's job, D2/D3). |
| **`SqlContractSerializerBase.hydrateSqlStorage` cross-ref passthrough** | The existing serializer passes the `models` / `valueObjects` / `roots` subtree through unchanged (lines 108–115 of [`sql-contract-serializer-base.ts`](../../../../../packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts)); cross-refs ride along as plain JSON. D1's "change" is a no-op at the hydration level. | Hydration writes the JSON shape into `Contract<SqlStorage>`'s `roots` / `models` / `valueObjects` fields; validator already enforces the structural shape. No new framework structure. |
| **Removal of bare-string `to` / `base` / `roots` shapes** | Deletion of legacy shape declarations; subtractive. | No enforcement structure added or removed — pure type-shape cleanup. |

**Default stance for this dispatch:** *tighten existing shapes to carry the entity coordinate; do not add new identity-encoding structures.* Briefs that cannot answer (a) or (b) satisfactorily for any new proposed field or registry **MUST NOT lock** — escalate to design discussion (I12).

## Brief overlay (drive-build-workflow execution discipline)

The brief author **must** carry these forward into the implementer's first message:

- **F5 forbidden:** No destructive git operations (no `git reset --hard`, no force-push, no `rm -rf .git`, no `git checkout --` on un-staged work). Implementer commits incrementally and pushes at the end of the dispatch.
- **Lockfile-cruft refusal trigger:** if `pnpm install` adds any `test-NNNN-*` ephemeral importer or `@prisma-next/*@0.10.0` published-package refs to `pnpm-lock.yaml`, HALT — do not commit; report. (S1.B D2-R2 retro: leaked importers cost a follow-up reconciliation commit.)
- **Stale-dist hygiene pre-flight:** run `pnpm install && pnpm build` (or `rm -rf .turbo && pnpm build --force`) BEFORE running `pnpm typecheck`. Quoted typecheck failures without this pre-flight are not load-bearing (retro 2026-05-22 — second-instance stale-dist failure mode).
- **F3 required:** Run the grep pre-flight (step 1) and commit the file list to the dispatch commit body **before** any source edits.
- **F1 forbidden patterns:** No `to: string | { namespace, model }` transitional union. No `relation.toNamespace` parallel field. No `roots: { …: string | CrossReference }` permissive shape. No "temporary" dual-shape acceptance at the validator layer. The shape move is one-way and atomic in the source diff.
- **F6 forbidden:** No new field on `AuthoringEntityTypeDescriptor`, `FamilyDescriptor`, or any framework-layer registry / lookup table. No `flatModelsRegistry`, `crossReferenceTable`, `namespaceIdAllowList`. No runtime validation registry for `NamespaceId` (the brand is compile-time only — Decision A).
- **Build cascade order required:** `contract` → {`sql-contract`, `mongo-contract`} → {`family-sql`, `family-mongo`} → `target-postgres`. Skipping the cascade leaves stale `dist/*.d.mts` and produces false typecheck signals.
- **File-count re-decomp trigger:** D1's plan-stated working ceiling is ~12 source files; D1's brief forecast is ~15. If `git diff --stat` shows > 18 files under `packages/` OR the typecheck cascade pulls in > 25 files, HALT and request re-decomposition into **D1a** (framework substrate + validators) + **D1b** (family schemas + serializer hydration + FK type tightening). The implementer must not push past this threshold without explicit re-plan.
- **Scope guardrails:** if you find yourself touching authoring lowering (`packages/*/2-authoring/`) OR emitter typegen (`packages/*/3-tooling/emitter/`) OR fixture regen (`examples/`, `test/fixtures/`, `**/contract.{json,d.ts}`) OR Mongo authoring OR downstream consumers (ORM-client, query-builders, planner), HALT — those are D2 / D3 territory.
- **integration + fixtures:check is a non-gate for D1.** Do not run `pnpm fixtures:emit`. Do not edit any `.json` / `.d.ts` files under `examples/`, `test/fixtures/`, `packages/**/test/fixtures/`.

## Refusal triggers (halt — do not work around)

- **Implementer proposes a transitional `relation.to: string | { namespace, model }` union or any dual-shape acceptance.** F1; A6 confirmed hard-cut.
- **Implementer adds a `flatModelsRegistry` / `crossReferenceTable` / `namespaceIdAllowList` framework-level structure.** F6; Decision A + Decision D rejected.
- **Implementer extends `NamespaceId` brand into a runtime validator with allow-lists.** F6; Decision A — brand is compile-time only.
- **`pnpm test:packages` regression cascades into > 5 family-level tests requiring shape rework beyond the substrate change.** Halt; D1a / D1b split.
- **Mongo family serializer base requires non-trivial cross-ref transform** (not a passthrough). Halt and surface — D1 expected zero edits there.
- **Codec-alias destination question surfaces mid-flight** (per-namespace codec aliases needed in-tree): halt → defer codec-alias move to a follow-up slice; preserve S1.C scope (spec OQ #5 falsifies).
- **`pnpm install --frozen-lockfile` surfaces drift or leaked importers.** Halt — do not edit `pnpm-lock.yaml` by hand; report.
- **Typecheck/cascade exceeds threshold:** `git diff --stat` shows > 18 package files OR typecheck pulls in > 25 files. Halt and re-decompose into D1a + D1b.
- **F7 — implementer hits an unbriefed structural blocker** (Turbo cycle, lint:deps refusal, hidden circular import) **and considers a workaround that crosses a layering boundary.** Halt and report; do not alias / `dependsOn` / re-export to bypass.

## Model tier

**Composer-2.5 (`composer-2.5-fast`).** Per [`drive/calibration/model-tier.md`](../../../../../drive/calibration/model-tier.md): scope-bounded shape contract migration with a fully-settled brief, four pre-locked design decisions (A/B/C/D), enumerated file list, and pre-walked Risk #5 (a)+(b) overlay. No design-judgment surface for the implementer.

**Escalate to Opus 4.7 (`claude-opus-4-7-thinking-high`)** if one of these surfaces:

- `NamespaceId` brand representation needs to flow into a runtime context (Decision A falsified — flag at brief assembly, do not silently switch to arktype-tagged).
- `CrossReference` shared type doesn't cover a fourth call site cleanly (e.g. a `Contract` field surfaces that needs a different cross-ref shape — Decision B re-litigation).
- `Contract.roots` change cascades into the framework canonicalization / hashing in a way the brief didn't anticipate (load-bearing canonical-sort change).
- Mongo family serializer base requires real cross-ref hydration logic (not passthrough) — surfaces a Mongo-side asymmetry the spec didn't capture.
- Risk #5 (a)+(b) cannot be answered for any proposed surface — revert to discussion mode; do not ship redundant surface (retro 2026-05-21).

## Dispatch hygiene

- One commit (preferred) or two commits is fine; both ending in a clean working tree. The framework substrate + validators + FK type tightening land in one cohesive commit; the family serializer touch (if any non-trivial) may live in a second commit for review clarity.
- Commit messages reference **TML-2624** in the trailer or body so GitHub auto-links to the parent project ticket. Also reference **TML-2586** in the commit that touches `ForeignKeyReference.namespaceId` / `ForeignKeySpec.references.schema` for the GitHub-integration close-out.
- DCO: every commit signed (`git commit -s`).
- Push at end of dispatch; do not push partial state intra-dispatch.

## Report back

Implementer's wrap-up message must contain:

1. **Final HEAD SHA + push confirmation.**
2. **Pre-flight grep inventory** (the file list captured at step 1).
3. **Lockfile + stale-dist pre-flight evidence** (`pnpm install --frozen-lockfile` exit code + diff summary of `pnpm-lock.yaml`; `pnpm build --force` exit code).
4. **Done-when gate results** — every checkbox above marked PASS / FAIL / N/A with one-line evidence (command output digest, grep hit count, test runner summary).
5. **Cascade size** (file count from `git diff --stat`; typecheck-cascade file count if it spiked beyond ~15 files).
6. **Decision A/B/C/D confirmations** — implementer confirms each pre-locked decision was implemented as specified; flags any deviation with rationale.
7. **Risk #5 (a)+(b) overlay confirmation** — for each surface touched, implementer confirms (a) and (b) were answered satisfactorily.
8. **Functional gate result** — the hand-rolled cross-reference round-trip test PASS / FAIL with output.
9. **Edge cases handled** — for each one in the Done-when list, one-line confirmation of how D1's diff handles it.
10. **Any refusal-trigger fires** — if zero, say so explicitly; if any fired, what was the trigger and what the implementer reported instead of working around.
11. **Handoff to D2** (see § Handoff below).

## Handoff to D2

The D2 brief assembler needs to know from D1's landing state:

- **Framework cross-ref type export path:** confirmed at `@prisma-next/contract/types` (`CrossReference`).
- **`NamespaceId` brand export path:** confirmed at `@prisma-next/contract/types` (`NamespaceId`, `asNamespaceId`).
- **`CrossReferenceSchema` arktype location:** declared in the framework cross-reference file; re-exportable for downstream validators.
- **SQL + Mongo validators accept the new envelope:** confirmed clean against the existing test contracts that don't carry cross-refs (`packages/2-sql/1-core/contract/test/sql-storage.test.ts` and Mongo equivalents).
- **Family serializer passthrough preserves cross-refs:** confirmed via the functional gate round-trip test.
- **Known D2 entry points** (for D2 brief assembly):
  - SQL authoring TS DSL: `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` line 464 (`to: relation.toModel` → object pair), `contract-lowering.ts`
  - SQL authoring PSL: `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` lines 1457–1605 region
  - Mongo authoring TS: `packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts` (`normalizeRoots`, relation lowering)
  - Mongo authoring PSL: `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`
  - Framework emitter typegen: `packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts` (`generateModelRelationsType`, model.base, roots emission)
  - Mongo state classes consumer: `packages/2-mongo-family/5-query-builders/query-builder/src/state-classes.ts`, `lookup-builder.ts`
  - SQL orm-client consumer: `packages/3-extensions/sql-orm-client/src/collection-contract.ts`, `model-accessor.ts`, `mutation-executor.ts`
- **Stub for orchestrator to update post-D1:**
  - `<D1 HEAD SHA>` — fills the D2 brief's "land D2 on top of" reference
  - `<D1 file count>` — informs D2's cascade-size budget
  - `<Any refusal-trigger fires>` — orchestrator decides whether to re-decompose D2's scope or proceed as planned

## References

- Slice spec: [`../spec.md`](../spec.md) (Per-dispatch DoR overlay answer table; Edge cases)
- Slice plan: [`../plan.md`](../plan.md) § Dispatch 1
- Parent project plan: [`../../../plan.md`](../../../plan.md) § S1.C (Risk #5 mitigation context)
- ADR: [`../../../adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) — Decision 1 (two planes), Decision 4 (cross-references as object pairs), Decision 6 (entity coordinate)
- PR #534 precedent (object-pair FK shape): [`packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts`](../../../../../packages/2-sql/1-core/contract/src/ir/foreign-key-reference.ts)
- Subsumed: [TML-2586](https://linear.app/prisma-company/issue/TML-2586) — `ForeignKeySpec.references.schema` typed as `NamespaceId`
- Calibration: [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) (F1 / F3 / F5 / F6 / F7), [`grep-library.md`](../../../../../drive/calibration/grep-library.md), [`sizing.md`](../../../../../drive/calibration/sizing.md), [`model-tier.md`](../../../../../drive/calibration/model-tier.md)
- Retro: [`drive/retro/findings.md`](../../../../../drive/retro/findings.md) (2026-05-21 — Risk #5 root cause; 2026-05-22 — stale-dist hygiene second-instance; S1.B D2-R2 — lockfile-leak)
- Rules: [`.cursor/rules/no-direct-lockfile-edits.mdc`](../../../../../.cursor/rules/no-direct-lockfile-edits.mdc) (never edit `pnpm-lock.yaml` by hand)
- S1.A landings consumed: `Contract.domain` optional field, narrowed `Namespace`, descriptor registry, structural slot loop in `sql-contract-serializer-base.ts`
- S1.B landings consumed: `NamespaceRawSchema` `'+': 'ignore'` (TML-2658), descriptor-driven enum slot at `storage.<ns>.enum`
- S1.B retro: D2-R2 lockfile reconciliation pattern (133-line cruft removed; if pnpm install leaks transient test-app importers, halt and clean before commit)
