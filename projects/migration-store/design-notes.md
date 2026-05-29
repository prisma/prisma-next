# Design notes: migration-store

> Synthesized design for unifying the migration read-commands on one tolerant contract-space model. Read this to understand **what the design is**, **what principles it serves**, and **what alternatives were rejected**. Captures the settled design, not a chronological log.
>
> Owned by the Orchestrator. Cross-linked from [`./spec.md`](./spec.md).

## Principles this design serves

- **One model of project state.** There is a single thing — migration state on disk (contract spaces, their packages, their refs, the graph those packages induce). Commands are progressive queries over it, not separate models.
- **Separate building from judging.** Constructing a data structure and validating that it satisfies an invariant are different responsibilities. A constructor that throws on an integrity violation forces its opinion on every reader.
- **Tolerance is cross-cutting.** A half-broken project on disk is a real state. *Every* consumer — read commands and apply/verify alike — must read it and report inconsistencies through one structured vocabulary, not crash.
- **Pay for what you query.** Cheap reads must not fund expensive facets. Lazy facets, not separate models, are how `list` avoids paying for `status`'s graph and contract work.
- **Ubiquitous language.** `ContractSpace*`, `storage hash`, `ref`. No invented synonyms (`ContractHash`), no concept-fusing contractions (`dbHash`).

## The model

### One aggregate, three separated responsibilities

`ContractSpaceAggregate` stays the single model (app member + extension members; each a `ContractSpaceMember`). The project pulls apart three things it currently fuses:

1. **Build (tolerant, eager-but-cheap).** Enumerate spaces from disk (`listContractSpaceDirectories` + reserved-name / `isValidSpaceId` filtering), load each space's raw migration packages (`readMigrationsDir`), and load its refs — both the system `head` ref (`readContractSpaceHeadRef`) **and the user-authored `production` / `staging` / `db` pointers** under `migrations/<space>/refs/*.json` (the one capability the aggregate genuinely lacked). The build represents inconsistencies; it does not abort on them.

2. **Query (lazy facets).** `graph()` reconstructs a space's `MigrationGraph` on first call and memoises it — pure structure, no validation. The deserialized `contract` is likewise a lazy facet. A command pays only for what it reads: `list` touches neither.

3. **Judge (integrity as a query).** A single integrity-check surface walks the loaded model and returns a structured violation list: the former `SAME_SOURCE_AND_TARGET` (useless self-edge), layout drift (orphan / declared-but-unmigrated space dirs), disjointness (two spaces claim one storage element), head-ref-not-in-graph, migration-hash mismatch, target mismatch, undeserializable contract. Consumers apply policy:
   - `list` / `graph` / `show` / `log` — ignore (render what's there).
   - `migration check` — render all, map to `PN-MIG-CHECK-*`.
   - apply / verify — refuse on the violations that gate correctness.

### The self-edge move is the keystone — but tolerance is broader

`errorSameSourceAndTarget` is thrown in exactly one place — inside `reconstructGraph` (`migration-graph.ts:53-57`), the shared constructor. Removing it from there makes graph-building pure. But tolerance is not only about that one throw: `readMigrationsDir` (`io.ts`) *also* throws on a migration-hash mismatch, a `providedInvariants` mismatch, and a malformed/missing manifest. A truly tolerant load relocates all of these:

- **Recoverable** (self-edge, hash mismatch, providedInvariants mismatch, missing/orphan head ref) → represented `IntegrityViolation`, package/space retained.
- **Genuinely unloadable** (unparseable JSON, schema-invalid manifest) → `packageUnloadable` violation, that one package omitted from `member.packages` — per-package, never fatal to the whole aggregate.

The bounded `reconstructGraph` caller set to re-point (`migration-new`, `migration-show` ×3, `command-helpers.loadMigrationPackages`, `aggregate/loader` ×2, `compute-extension-space-apply-path`) is small enough to handle deliberately and pin with integration tests per consumer class.

A concrete win falls out: `migration check` today catches the *first* thrown load error and bails (`migration-check.ts:140-166`), so it can only ever report one failure per run. A tolerant load + `checkIntegrity()` that returns the full violation list lets `check` report **every** problem at once — the UX the loader's own layout-violation comment already aspired to.

### Construction without a contract

For `list` / `graph` to use the model, construction must not require a deserializable app `Contract` or a reconciled `extensionPacks` declaration. The aggregate builds from disk alone (`{ migrationsDir, deserializeContract }`); the contract is a lazy `contract()` facet, and config-dependent checks (layout drift, disjointness, target match) are produced by `checkIntegrity()` only when the caller passes `declaredExtensions` / `requireContracts`. `status` / `show` / apply / verify supply those; `list` / `graph` don't. This is what keeps it one model rather than two.

## Alternatives considered

- **A new `MigrationStore` / `ContractSpaceView` read-model beside the aggregate (the original ticket design).** **Rejected because:** it is a second data model for one concept — project migration state on disk — partitioned on an axis (tolerant/disk-only vs validating/contract-aware) the names didn't even encode. The "missing" capabilities it added (tolerance, user refs, lazy graph) are traits the *one* model should have, not justification for a second one.
- **Validate inside `reconstructGraph` (status quo).** Attractive: one place, readers get the check for free. **Rejected because:** it fuses building with judging and forces a single integrity opinion on every reader, including ones (`list`) that must tolerate the exact case it rejects. The check belongs in the integrity surface.
- **Eagerly hydrate every graph + contract at load (status quo aggregate).** **Rejected because:** it makes `list` pay to reconstruct graphs and deserialize contracts it never reads, and it turns content problems into load-time crashes. Lazy facets give the perf win *within* one model.
- **Keep two readers — aggregate for the heavy/validating consumers, a tolerant disk reader for `list` / `graph`.** Considered as the "narrow consolidation." **Rejected because:** fault tolerance and "packages + refs + graph linkages" are needed by every consumer; the split was a query-depth difference dressed as a model boundary. One model with lazy facets covers both without duplication.
- **Make tolerance a per-command concern (each command catches and ignores).** **Rejected because:** that re-scatters the inconsistency handling the project exists to consolidate, and gives no consistent vocabulary for reporting. Tolerance + structured violations belong in the model + integrity surface.
- **Naming: `MigrationStore`, `ContractHash`, `dbHash()`.** **Rejected because:** the model's aggregate root is the contract space, not the migration; `ContractHash` is a synonym for the canonical *storage hash*; `dbHash()` fuses a ref name and a hash into a non-concept. Use `ContractSpaceAggregate`, `StorageHash`, and a ref lookup.

## Resolved decisions

- **Model shape → value with lazy facets + query methods, not interface + factory.** A snapshot of disk state, not a stateful service; lazy memoisation is a pure cache. `app` / `extensions` fields are retained for existing planner / verifier consumers; `space()` / `spaces()` / `listSpaces()` / `hasSpace()` / `checkIntegrity()` + lazy `graph()` / `contract()` are added for the read commands.
- **Construct from disk alone.** `loadContractSpaceAggregate({ migrationsDir, deserializeContract })`. No eager contract, no required `extensionPacks`. Contract is a lazy facet; config/contract-dependent checks are opt-in via `checkIntegrity()` options. This is the load-bearing decision behind the one-model claim.
- **Integrity surface → `checkIntegrity()` on the aggregate, in migration-tools**, returning `readonly IntegrityViolation[]` (discriminated union). The CLI maps to the existing `5001` / `5002` envelopes + `PN-MIG-CHECK-*`. Defined in migration-tools so `check`, apply, and verify all consume the same primitive.
- **Unparseable / schema-invalid manifest → `packageUnloadable` violation, package omitted** (per-package tolerant, not whole-aggregate fatal). Recoverable integrity problems (self-edge, hash mismatch, providedInvariants mismatch) are represented violations with the package retained.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md) (pending `drive-plan-project`)
- Existing model: `packages/1-framework/3-tooling/migration/src/aggregate/{types,loader}.ts`
- Self-edge throw: `packages/1-framework/3-tooling/migration/src/migration-graph.ts:53-57`
- Subsystem: [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- ADR: [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
- Linear: [TML-2709](https://linear.app/prisma-company/issue/TML-2709/introduce-migrationstore-load-once-queryable-multi-space-migration); depends on TML-2697 (PR #603)
