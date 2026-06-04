# Learnings — explicit-namespace-dsl

Working ledger (orchestrator-maintained). Cross-cutting lessons migrate to durable docs at close-out; project-local ones drop with the folder.

## Patterns surfaced this run

### ORM query-execution path was not covered by the prerequisite's qualification machinery

**Surfaced:** slice 01, D2 (both implementer and reviewer flagged independently).

The project spec assumed the explicit namespaced accessors would be queryable end-to-end by reusing TML-2605's runtime-qualification machinery ("no parallel qualification pipeline"). That holds for the **SQL builder** path (`sql.<ns>.<table>` → `TableProxyImpl(namespaceId)` → qualified emission). It does **not** hold for the **ORM** path: `collection-contract.ts`'s `modelsOf()` resolves model metadata via `domainModelsAtDefaultNamespace()`, which *throws* on any multi-namespace contract (`soleDomainNamespaceId`). So `orm.<ns>.<Model>` accessor resolution works (table coordinate threaded via `Collection`'s `options.tableName`), but end-to-end query *execution* on a multi-namespace contract is blocked until the collection metadata-resolution path is made namespace-aware.

**Implication:** an ORM-execution-namespace-awareness substrate change (to `collection-contract.ts` + the metadata path) is required to deliver AC6's ORM half / AC2's runtime half — work the spec did not scope. Routed to the operator as a shape decision (fold into slice 01 vs a separate slice). TML-2605's "consume the machinery, no parallel pipeline" framing was accurate only for the SQL emission path.

### The ORM single-namespace assumption is threaded layer-by-layer — each dispatch surfaced the next

**Surfaced:** slice 01, D3→D4→D5→D6 (each dispatch's report flagged the next layer).

Making the ORM execution path namespace-aware was estimated as ~1 dispatch when the operator chose to fold it into slice 01 (decision (a)). It became **four**: D3 metadata-resolution core → D4 select + count CRUD → D5 returning-row mutations → D6 cross-namespace relation resolution. Each dispatch threaded one bounded layer of the `domainModelsAtDefaultNamespace`-throws assumption and surfaced the next (select → returning → models-with-relations → cross-namespace relation targets). The operator twice chose (a) (fold the next layer in) over carving a separate slice, accepting a heavy 9-dispatch PR1, because D3–D5 were already committed in slice 01 and splitting would un-bundle them. **Lesson for future namespace/coordinate-threading retrofits:** when a pervasive single-X assumption is being made X-aware, size it as a multi-dispatch sub-effort up front (metadata → read execution → write execution → relations), not one dispatch — the layers are discoverable by reading the resolver call-graph before the first dispatch.

**Decision (a) ×2:** ORM execution-awareness folded into slice 01 (D3–D5); cross-namespace relations folded into slice 01 (D6). Cross-namespace nested-relation *writes* remain a candidate follow-up. The cross-namespace join itself (AC6) is also provable via the SQL builder independent of all the ORM relation work.
