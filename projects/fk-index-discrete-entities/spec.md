# FK1 — Foreign keys and indexes are discrete contract entities

Implements the corrected model recorded in [ADR 161](../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) (superseded in [#960](https://github.com/prisma/prisma-next/pull/960)). One PR.

## At a glance

The question the current design cannot answer: **a foreign key has a backing index — what is that index's name?**

Today `auth.identities`' `user_id` foreign key records `index: true`. The emitted `contract.json` asserts "a backing index exists" but cannot state that it is named `identities_user_id_idx` — the name lives only in a rule (`defaultIndexName(table, cols)`) re-run *outside* the contract, on every plan/verify/emit. That is a fact about a named database object encoded as a boolean plus a reconstruction rule.

Before — per-FK booleans, index implied and unnamed:

```jsonc
"foreignKeys": [
  { "source": { "columns": ["user_id"] }, "target": { "tableName": "users", "columns": ["id"] },
    "onDelete": "cascade", "constraint": true, "index": true }
],
"indexes": []
```

After — the constraint and the index are each their own entity, and the index carries its real name:

```jsonc
"foreignKeys": [
  { "source": { "columns": ["user_id"] }, "target": { "tableName": "users", "columns": ["id"] },
    "onDelete": "cascade" }
],
"indexes": [
  { "columns": ["user_id"], "name": "identities_user_id_idx" }
]
```

A foreign key whose columns have no backing index (real Supabase does this for 16 FKs) emits *only* the `foreignKeys[]` constraint entry and no `indexes[]` entry — absence of the index entity is the fact, replacing `index: false`. A logical relation with no physical constraint (PlanetScale-style) emits *no* `foreignKeys[]` entry at all; the domain relation still carries the relationship.

## Chosen design

The schema-IR layer already has exactly this shape and always has. `SqlForeignKeyIR` has never carried `constraint`/`index`; `SqlIndexIR` has always been a flat, name-carrying, provenance-blind entity. Every consumer below the contract→schema-IR boundary — planner, differ, DDL emitter, `db verify` — already operates as if foreign keys are constraint-only and indexes are fully discrete.

The entire gap between today and FK1 is one function. `contractToSchemaIR`'s `convertTable` ([`packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:311-340`](../../packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts)) performs the materialization **transiently, on every call**: its `satisfiedIndexColumns` loop turns each `index: true` FK whose columns aren't already covered into a synthesized, `defaultIndexName`-named `SqlIndexIR`, and its `.filter(fk => fk.constraint !== false)` drops non-constraint FKs. FK1 moves that same computation to run **once, at `contract emit`**, and persists the result.

The change, end to end:

1. **Materialize at emit.** In the emit pipeline, lower each `ForeignKey`'s `constraint`/`index` inputs into discrete persisted entities: drop the FK entity when `constraint` is false; append a named `indexes[]` entry (via the shared backing predicate + `defaultIndexName`) when `index` is true and the columns aren't already backed by a declared index/unique/PK. This is the `satisfiedIndexColumns` logic, moved and made permanent.

2. **Strip the booleans from the persisted entity.** Remove `constraint`/`index` from the `ForeignKey` IR node ([`ir/foreign-key.ts`](../../packages/2-sql/1-core/contract/src/ir/foreign-key.ts)), the `ForeignKeySchema` arktype ([`ir/storage-entry-schemas.ts`](../../packages/2-sql/1-core/contract/src/ir/storage-entry-schemas.ts)), and the `contract.d.ts` FK literal generator ([`emitter/src/index.ts:625-635`](../../packages/2-sql/3-tooling/emitter/src/index.ts)). A persisted `foreignKeys[]` entry is source + target + `onDelete`/`onUpdate` only.

3. **Keep the booleans as authoring input only.** PSL `@relation(index:)`, the TS builder `fk({ constraint, index })` / `foreignKeyDefaults`, and `applyFkDefaults` stay — they feed the emit-time materialization decision and never reach `contract.json`.

4. **Delete the now-dead reconstruction.** Remove the `satisfiedIndexColumns` loop and the `constraint !== false` filter from `convertTable` (the persisted contract already carries the materialized entries), the dead `if (!fk.constraint)` guard in the SQLite `renderForeignKeyClause`, and re-derive the one raw-boolean read in the Postgres backfill-strategy helper ([`planner-strategies.ts:687-691`](../../packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts)) from FK presence (post-FK1 a persisted `foreignKeys[]` entry *is* a constraint).

5. **Re-emit repo-wide.** Regenerate every FK-bearing `contract.json` + `contract.d.ts` (14 files across `examples/`, `packages/3-extensions/supabase`, and `test/integration` fixtures). Confirm the ~32 FK-free contracts re-emit byte-identical.

The `defaultIndexName` computation and the `backingIndexColumnKeys`/`isBackedByColumnKeys` predicate ([`foreign-key-index-backing.ts`](../../packages/2-sql/9-family/src/core/foreign-key-index-backing.ts)) already shipped and are already shared with the PR #960 inferrer — FK1 reuses them at the new emit-time call site; the inferrer keeps emitting `@relation(index: false)` at the authoring layer (that is input, not output).

## Coherence rationale

One reviewer holds this in one sitting: it is a single representation change with a small logic delta (move one loop to emit, strip two fields, delete dead code) plus a large but *generated* diff (the re-emitted contracts). It must land atomically — the IR/schema change, every consumer, and the re-emitted contracts are one rollback unit; any split leaves an intermediate where the persisted contract and its readers disagree on whether FKs carry `constraint`/`index`. Behaviour is unchanged at every layer (the schema-IR the planner/verifier see is identical); this is a representation change, not a bug fix.

## Scope

In:

- `ForeignKey` IR + arktype schema: remove `constraint`/`index`.
- Emit pipeline: materialize discrete FK constraint + named index entities.
- `contract.d.ts` FK literal generator.
- Delete `satisfiedIndexColumns` loop + `convertTable` filter; delete SQLite `renderForeignKeyClause` dead guard; re-derive `planner-strategies.ts` FK-presence signal.
- Repo-wide re-emit of FK-bearing contracts.

Deliberately out:

- **The wider "facts not instructions" doctrine.** Frame FK1 narrowly on the FK/index case + the reconciliation regression. Control policy (ADR 224) is a *stronger* interpret-me field (`control: 'managed'` resolves to `external` under an external default) and ~10 such conventions exist; chasing them is a doctrine-level program, not this slice. Control policy is **not** a peer offender here — it sits on the present-vs-reconstructed axis, not the facts-vs-instructions one.
- **FK2 — the `auth`/`storage` contract-space split** (separate deferred slice).
- **Mongo-family contracts** — no FK entities; content unchanged (regression-checked only).

## Pre-investigated edge cases

- **A user-declared index already backs the FK columns.** Today's loop dedups via `satisfiedIndexColumns` and synthesizes nothing; the persisted materialization must keep that dedup so re-emit does not mint a duplicate `${table}_${cols}_idx` alongside the user's index.
- **`constraint: false` FK.** Persists as *no* `foreignKeys[]` entry (only an `indexes[]` entry if `index: true`). This is the intended loss of the boolean, not a dropped fact — the domain relation still models the relationship. Confirm the Postgres backfill-strategy helper (which today reads `constraint === false`) behaves identically when such FKs are simply absent from `foreignKeys[]`.
- **Cross-space FKs** (`supabase:auth.AuthUser`, interpreter local + cross-space push sites) carry `index`; materialization applies uniformly.

## Definition of done

Every re-emitted `contract.json`/`contract.d.ts` is byte-stable on a second `contract emit` and carries no `constraint`/`index` on any FK; the `satisfiedIndexColumns` loop is deleted; FK-free contracts re-emit unchanged. (CI-green + reviewer-accept inherited.)

## Open questions

None blocking. The `planner-strategies.ts` FK-presence re-derivation (step 4) is expected to be a straight "presence implies constraint" swap; confirm against its one call path during build rather than pre-committing a signal here.

## References

- [ADR 161 — corrected model](../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) (lines 5–46).
- Grounding: `contract-to-schema-ir.ts:311-340` (the loop to move), `foreign-key-index-backing.ts` (shared predicate), `emitter/src/index.ts:625-635` (`.d.ts` FK literal), `planner-strategies.ts:687-691` (raw-boolean read).
- Sibling deferral: [FK2](../extension-supabase/plan.md) (§ Follow-ups surfaced by this project).
