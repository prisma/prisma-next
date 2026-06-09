# Learnings — explicit-namespace-dsl

Working ledger (orchestrator-maintained). Cross-cutting lessons migrate to durable docs at close-out; project-local ones drop with the folder.

## Patterns surfaced this run

### Mongo's ORM/query surfaces are root-keyed, never part of the namespaced-only cut — slice-02 facade projection is a mongo no-op

**Surfaced:** slice 02, D4 (implementer halt + orchestrator decision).

Slice 02's facade projection (postgres qualified / sqlite+mongo flat-via-`__unbound__`) presupposed all three target ORMs were converted to namespace-keyed maps (`{ [ns]: facet }`) so the unbound target could alias `db.orm = orm.__unbound__`. That holds for the **SQL family** (slice 01 + D1/D2 cut `sql-builder`/`sql-orm-client` to namespaced-only). It does **not** hold for **mongo**: `mongo-orm`'s `MongoOrmClient` keys on `TContract['roots']` (model names — `{ users, tasks }`), and `mongo-query-builder`'s `db.query` is a method API (`{ from, rawCommand }`), not a property map. Neither carries a `[UNBOUND_NAMESPACE_ID]` facet. Mongo is inherently single-namespace (`__unbound__`), so there is no namespace dimension to qualify, **no flat fallback to remove, and no facet to alias**. The mongo facade is therefore already in the slice's intended end-state for an unbound target — flat `db.orm.<Model>` works and is asserted by `mongo/test/mongo.types.test-d.ts` (`keyof Db['orm']` = `'tasks' | 'users'`).

**Decision (operator-delegated, orchestrator-made):** D4-mongo closes as a **no-op**. AC4/AC5's mongo arm is satisfied **by construction** (mongo `db.orm` is flat/root-keyed = the "unbound → flat" rule; no per-target switch exists), evidenced by the existing green mongo type-test, not by a new alias. The project spec's AC4/AC5 mongo wording ("`db` aliased to `orm.__unbound__`") describes a *mechanism* that doesn't apply; the *outcome* (flat ergonomics on the unbound mongo target) is met. **Lesson:** when a cross-target "projection"/"always-qualified" mandate is written, check each target's builder *keying* up front — a target that was never multi-namespaced (and whose ORM keys by model/root) needs neither the cut nor the projection. The D6 ADR documents mongo's root-keyed surface as a deliberate exception; spec AC4/AC5 mongo wording reconciled at close-out.

### ORM query-execution path was not covered by the prerequisite's qualification machinery

**Surfaced:** slice 01, D2 (both implementer and reviewer flagged independently).

The project spec assumed the explicit namespaced accessors would be queryable end-to-end by reusing TML-2605's runtime-qualification machinery ("no parallel qualification pipeline"). That holds for the **SQL builder** path (`sql.<ns>.<table>` → `TableProxyImpl(namespaceId)` → qualified emission). It does **not** hold for the **ORM** path: `collection-contract.ts`'s `modelsOf()` resolves model metadata via `domainModelsAtDefaultNamespace()`, which *throws* on any multi-namespace contract (`soleDomainNamespaceId`). So `orm.<ns>.<Model>` accessor resolution works (table coordinate threaded via `Collection`'s `options.tableName`), but end-to-end query *execution* on a multi-namespace contract is blocked until the collection metadata-resolution path is made namespace-aware.

**Implication:** an ORM-execution-namespace-awareness substrate change (to `collection-contract.ts` + the metadata path) is required to deliver AC6's ORM half / AC2's runtime half — work the spec did not scope. Routed to the operator as a shape decision (fold into slice 01 vs a separate slice). TML-2605's "consume the machinery, no parallel pipeline" framing was accurate only for the SQL emission path.

### The ORM single-namespace assumption is threaded layer-by-layer — each dispatch surfaced the next

**Surfaced:** slice 01, D3→D4→D5→D6 (each dispatch's report flagged the next layer).

Making the ORM execution path namespace-aware was estimated as ~1 dispatch when the operator chose to fold it into slice 01 (decision (a)). It became **four**: D3 metadata-resolution core → D4 select + count CRUD → D5 returning-row mutations → D6 cross-namespace relation resolution. Each dispatch threaded one bounded layer of the `domainModelsAtDefaultNamespace`-throws assumption and surfaced the next (select → returning → models-with-relations → cross-namespace relation targets). The operator twice chose (a) (fold the next layer in) over carving a separate slice, accepting a heavy 9-dispatch PR1, because D3–D5 were already committed in slice 01 and splitting would un-bundle them. **Lesson for future namespace/coordinate-threading retrofits:** when a pervasive single-X assumption is being made X-aware, size it as a multi-dispatch sub-effort up front (metadata → read execution → write execution → relations), not one dispatch — the layers are discoverable by reading the resolver call-graph before the first dispatch.

**Decision (a) ×2:** ORM execution-awareness folded into slice 01 (D3–D5); cross-namespace relations folded into slice 01 (D6). Cross-namespace nested-relation *writes* remain a candidate follow-up. The cross-namespace join itself (AC6) is also provable via the SQL builder independent of all the ORM relation work.

### Same-bare-table-name e2e: full-pipeline gap, and the "bare = default namespace" design

**Surfaced:** D10 (blocked) + operator review. The same-bare-TABLE-name case (AC1's hard case) is blocked not at the query layer (D7/D8 fixed that) but in the **pipeline around it**: authoring dup-table guard (`build-contract.ts`), PSL bare-model-name keying, contract validation (TML-2807 on main made this namespace-aware), and the execution-context codec registry (`codecRefForColumn(table,column)` — no coordinate). D1–D8's unit tests passed for 8 dispatches *because they bypassed the pipeline* (hand-built contracts). Rebasing onto `origin/main` (TML-2807: `SqlModelStorage.namespaceId` + kind-agnostic storage hash) was clean and cleared the validation layer, but left authoring + codec-registry.

**Design decision (operator):** bare/flat references resolve to the **connector's `defaultNamespaceId`** (already on the target descriptor), NOT via scan-and-fail-fast or deferral to `storage.namespaceId`. This is the spec's own model (FR6 always-qualified builder; AC4/AC5 facade aliases `db` to the default-namespace facet). It collapses two resolution paths into one (coordinate; bare = default coordinate), retires D7's scan/fail-fast bare branch, and unifies the flat surface with slice 02's facade projection. It does NOT remove the need to (a) drop the authoring dup-guard so two same-bare-named tables are *representable*, or (b) coordinate-key the execution-context codec registry for non-default-namespace tables.

**Implementation chain (on the rebased base):** P1 authoring (allow same-bare-table-name contracts) → P2 execution pipeline (coordinate-key registry/context + bare=default) → P3 e2e PGlite proof. Lesson: a headline AC like "works when names collide" is a *full-pipeline* property (author → validate → load → query); unit tests that bypass the pipeline give false confidence — exercise the real author→emit→load→query path early.
