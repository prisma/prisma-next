# Summary

Restructure the emitted contract to implement ADR 172's domain-storage separation, extracting the shared domain-level representation into a framework-level `ContractBase` that both SQL and Mongo families consume. This is the foundational step toward cross-family consumer code (ORM clients, validation, tooling).

# Description

Today, everything above `ContractBase` is SQL-specific. `ContractBase` is a thin header (hashes, target, capabilities). `SqlContract` extends it and adds `models`, `relations`, `storage`, and `mappings` — but the model fields shape (`{ column: string }`), the top-level table-keyed relations, and the mappings section are all SQL artifacts, not domain concepts.

The MongoDB PoC proved that the domain level — `roots`, `models` (with `{ nullable, codecId }` fields, optional `discriminator`/`variants`/`base`), and `model.relations` — is structurally identical across families. Only the storage details diverge: SQL needs field-to-column mappings, table schemas, and indexes; Mongo needs collection names.

This project widens `ContractBase` to carry the shared domain structure, updates the SQL emitter to produce the ADR 172 JSON structure, extracts common domain validation, and migrates consumers incrementally — all without breaking active development on the ORM client or DSL workstreams.

**Key insight:** Consumers never read `contract.json` directly — they access the contract through `validateContract()`, which parses the JSON and returns a typed object. This means the emitted JSON structure can change freely in Phase 1 (go straight to ADR 172's target structure), as long as `validateContract()` continues to return a type with all the fields consumers currently rely on. The "additive" constraint applies to the TypeScript types consumers see, not to the JSON itself.

**Key constraint:** Alexey is actively developing the SQL ORM client, and Alberto is working on the DSL/authoring layer. The TypeScript types returned by `validateContract()` must be widened (add new fields), not contracted (don't remove old fields yet), to avoid blocking either workstream.

# Before / After

## contract.json (emitted JSON)

**Before** (current — SQL-specific structure):

```json
{
  "models": {
    "User": {
      "fields": {
        "id": { "column": "id" },
        "email": { "column": "email" },
        "name": { "column": "display_name" }
      },
      "relations": {},
      "storage": { "table": "user" }
    }
  },
  "relations": {
    "post": {
      "user": {
        "to": "User", "cardinality": "N:1",
        "on": { "childCols": ["id"], "parentCols": ["userId"] }
      }
    }
  },
  "mappings": {
    "modelToTable": { "User": "user" },
    "tableToModel": { "user": "User" },
    "fieldToColumn": { "User": { "id": "id", "name": "display_name" } },
    "columnToField": { "user": { "id": "id", "display_name": "name" } }
  },
  "storage": {
    "tables": {
      "user": {
        "columns": {
          "id": { "nativeType": "character", "codecId": "pg/char@1", "nullable": false },
          "email": { "nativeType": "text", "codecId": "pg/text@1", "nullable": false },
          "display_name": { "nativeType": "text", "codecId": "pg/text@1", "nullable": true }
        }
      }
    }
  }
}
```

**After** (target — ADR 172 domain-storage separation):

```json
{
  "roots": {
    "users": "User",
    "posts": "Post"
  },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/char@1" },
        "email": { "nullable": false, "codecId": "pg/text@1" },
        "name": { "nullable": true, "codecId": "pg/text@1" }
      },
      "relations": {
        "posts": {
          "to": "Post", "cardinality": "1:N", "strategy": "reference",
          "on": { "localFields": ["id"], "targetFields": ["userId"] }
        }
      },
      "storage": {
        "table": "user",
        "fields": {
          "id": { "column": "id" },
          "email": { "column": "email" },
          "name": { "column": "display_name" }
        }
      }
    }
  },
  "storage": {
    "tables": {
      "user": {
        "columns": {
          "id": { "nativeType": "character", "codecId": "pg/char@1", "nullable": false },
          "email": { "nativeType": "text", "codecId": "pg/text@1", "nullable": false },
          "display_name": { "nativeType": "text", "codecId": "pg/text@1", "nullable": true }
        }
      }
    }
  }
}
```

Key changes in the JSON:
- `roots` is new — declares ORM entry points
- `model.fields` carries `{ nullable, codecId }` instead of `{ column }`
- `model.relations` is model-keyed with `strategy` and `on: { localFields, targetFields }`
- `model.storage.fields` carries the field-to-column mapping (moved from `model.fields`)
- Top-level `relations` and `mappings` are gone — their information now lives on the model

## ContractBase (framework type)

**Before** (current — thin header, no domain structure):

```typescript
interface ContractBase<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: TStorageHash;
  readonly executionHash?: TExecutionHash;
  readonly profileHash?: TProfileHash;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, Source>;
  readonly execution?: ExecutionSection;
}
```

**After** (target — includes domain structure):

```typescript
interface ContractBase<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> {
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly storageHash: TStorageHash;
  readonly executionHash?: TExecutionHash;
  readonly profileHash?: TProfileHash;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly sources: Record<string, Source>;
  readonly execution?: ExecutionSection;

  // Domain structure (new)
  readonly roots: Record<string, string>;
  readonly models: Record<string, {
    readonly fields: Record<string, { readonly nullable: boolean; readonly codecId: string }>;
    readonly relations: Record<string, {
      readonly to: string;
      readonly cardinality: string;
      readonly strategy: 'reference' | 'embed';
      readonly on?: { readonly localFields: readonly string[]; readonly targetFields: readonly string[] };
    }>;
    readonly storage: Record<string, unknown>;
    readonly discriminator?: { readonly field: string };
    readonly variants?: Record<string, unknown>;
    readonly base?: string;
  }>;
}
```

## SqlContract (Phase 1 — widened, not contracted)

During Phase 1, `SqlContract` carries both old and new fields. Consumers can read from either:

```typescript
type SqlContract<S, M, R, Map, ...> = ContractBase<...> & {
  readonly storage: S;
  readonly models: M;                     // has BOTH { nullable, codecId } and { column } on fields

  // Old fields (retained for consumer compatibility during Phase 1-2)
  readonly relations: R;                  // top-level table-keyed relations
  readonly mappings: Map;                 // modelToTable, fieldToColumn, etc.

  // New fields (from ContractBase)
  // readonly roots: ...                  // inherited from ContractBase
  // readonly models[m].relations: ...    // model-keyed relations (inherited)
  // readonly models[m].storage: ...      // field-to-column mapping (inherited)
};
```

## validateContract() bridging (Phase 1)

`validateContract()` parses the new JSON and derives old fields so consumers see no change:

```typescript
function validateContract<TContract extends SqlContract>(value: unknown): TContract {
  const contract = parseNewJsonStructure(value);      // reads ADR 172 JSON
  validateDomain(contract);                            // shared framework validation
  validateSqlStorage(contract);                        // SQL-specific validation

  // Bridge: derive old fields from new structure
  return {
    ...contract,
    mappings: deriveMappings(contract),                // model.storage → mappings
    relations: deriveTopLevelRelations(contract),      // model.relations → table-keyed relations
  } as TContract;
}

function deriveMappings(contract): SqlMappings {
  const modelToTable: Record<string, string> = {};
  const fieldToColumn: Record<string, Record<string, string>> = {};
  for (const [modelName, model] of Object.entries(contract.models)) {
    modelToTable[modelName] = model.storage.table;
    fieldToColumn[modelName] = {};
    for (const [fieldName, field] of Object.entries(model.storage.fields)) {
      fieldToColumn[modelName][fieldName] = field.column;
    }
  }
  // ... derive reverse mappings
  return { modelToTable, tableToModel, fieldToColumn, columnToField };
}
```

After Phase 3, the bridging logic and old fields are removed.

# Requirements

## Functional Requirements

### Phase 1: New contract structure (no consumer changes)

This phase changes the emitted JSON to match ADR 172's target structure, widens the TypeScript types, and updates `validateContract()` to parse the new JSON while continuing to return the old consumer-facing type. The ORM client, query builder, and contract authoring surfaces are untouched.

**Emitted JSON (can change freely):**

1. **Update the SQL emitter to produce ADR 172's JSON structure.** The emitter produces `contract.json` matching the target layout: `roots`, `models` with `{ nullable, codecId }` fields, `model.relations` (model-keyed, with `strategy` and `on: { localFields, targetFields }`), `model.storage` (with `table` and field-to-column mappings). The old top-level `relations`, `mappings`, and `model.fields: { column }` shape can be removed from the JSON or retained — consumers don't read the JSON directly.

2. **Update demo and test contract fixtures.** The demo app's `contract.json`, and contract fixtures embedded in tests across multiple packages (e.g., inline contract objects, fixture files, test helpers that construct contracts), all encode the current JSON structure. These must be audited and updated to match the new structure. This is likely the most labour-intensive part of Phase 1.

**Types (widen, don't contract):**

3. **Widen `ContractBase` to include domain structure.** Add `roots`, typed `models` (with `fields: Record<string, { nullable: boolean, codecId: string }>`, `relations`, optional `discriminator`/`variants`/`base`), and a generic storage extension point. `ContractBase` constrains family contracts via `extends ContractBase`, not `ContractBase<StorageType>` — storage details appear at multiple attachment points (model.storage, top-level storage, relation join details).

4. **Widen `SqlContract` to include new fields alongside old.** `SqlContract extends ContractBase` and adds SQL-specific storage. During this phase, `SqlContract` carries *both* the new domain fields (from `ContractBase`) and the old SQL-specific ones (`mappings`, top-level `relations`, `model.fields` with `{ column }` shape). This is what makes the transition non-breaking — existing consumers continue reading the old fields on the TypeScript type.

5. **Update `contract.d.ts` emission.** The emitted type file produces a `Contract` type that includes both old and new fields.

**Validation (bridges JSON → consumer types):**

6. **Update `validateContract()` to parse the new JSON and return the widened type.** `validateContract()` reads the new JSON structure and populates *both* the new domain fields and the old consumer-facing fields (e.g., deriving `mappings` from `model.storage`, deriving top-level `relations` from `model.relations`). Consumers see no change in the returned object.

7. **Extract shared domain validation.** Move the family-agnostic validation logic from `packages/2-mongo-family/1-core/src/validate-domain.ts` into the framework layer (`packages/1-framework/`). This covers: roots → model references, variant ↔ base bidirectional consistency, relation target existence, discriminator field existence, single-level polymorphism enforcement, orphaned model detection. SQL's `validateContract()` calls this as a first pass before SQL-specific storage validation.

### Phase 2: Migrate consumers to new type fields

The JSON is already in the target structure (Phase 1). `validateContract()` derives old fields from the new structure. This phase migrates consumers to read from the new TypeScript fields instead of the old ones.

1. **Migrate ORM client to read from domain fields.** The ORM client switches from reading `mappings.fieldToColumn` / `mappings.modelToTable` to reading `model.storage.fields` / `model.storage.table`, and from reading field types via the storage layer to reading `model.fields[f].codecId` and `model.fields[f].nullable`. It switches from the top-level `relations` to `model.relations`. This must be coordinated with Alexey.
2. **Migrate query builder and runtime.** The SQL query builder, relational core, and runtime shift to reading domain-level field metadata where appropriate. Runtime codec resolution uses `model.fields[f].codecId`.

### Phase 3: Remove old type fields

The JSON already lacks the old fields (removed in Phase 1). This phase removes the backwards-compatibility shim from `validateContract()` and the old fields from `SqlContract`.

1. **Remove `mappings` from `SqlContract` and `validateContract()`.** Once no consumer reads `modelToTable`, `tableToModel`, `fieldToColumn`, or `columnToField`, remove the type fields and the derivation logic in `validateContract()`.
2. **Remove old model field shape.** Remove `{ column }` from `model.fields` type — consumers now read `{ nullable, codecId }`. The field-to-column mapping lives in `model.storage.fields`.
3. **Remove top-level `relations` from `SqlContract`.** Once all consumers read `model.relations`, the top-level table-keyed `relations` type field and its derivation logic can be removed.

### Phase 4: Contract IR alignment (follow-up)

1. **Align `ContractIR` with the new contract JSON structure.** Update the internal representation used during emission so it more closely mirrors the emitted JSON. This reduces impedance mismatch and makes it easier for the DSL layer to target the IR. Coordinate timing with Alberto.

### Phase 5: Emitter generalization

With ADR 172's domain-storage separation, most of the `.d.ts` generation logic in `sqlTargetFamilyHook.generateContractTypes()` is now family-agnostic: roots, model domain fields (`nullable`, `codecId` → TypeScript types), model relations, import deduplication, hash type aliases, codec/operation type intersections, the `.d.ts` skeleton. Only the storage-level type generation (tables, columns, PKs, FKs, indexes, named type instances) and backward-compat types (`mappings`, old top-level `relations`) are genuinely SQL-specific.

This phase refactors the `TargetFamilyHook` interface so the framework `emit()` generates domain-level `.d.ts` content and the family hook provides only storage-specific type blocks. This eliminates the need for each family to duplicate ~60–70% of the type generation logic when implementing a new family emitter (e.g., Mongo).

1. **Refactor `TargetFamilyHook` interface.** Replace the monolithic `generateContractTypes()` method with a narrower interface. The framework generates domain-level sections (roots type, model domain fields, model relations, imports, hashes, codec types, `.d.ts` skeleton). The hook provides: `generateStorageType(storage)`, `generateModelStorageType(model)`, and any family-specific type blocks.
2. **Move domain-level type generation to the framework emitter.** Extract `generateRootsType()`, model field type generation (`generateColumnType()`), model relation type generation, import deduplication, hash aliases, and the `.d.ts` template from the SQL hook into the framework's `emit()`.
3. **Update SQL hook to implement the narrower interface.** The SQL hook retains `generateStorageType()` (tables/columns/PKs/FKs/indexes), `generateStorageTypesType()` (named type instances), and validation methods. It no longer owns the `.d.ts` skeleton or domain-level type generation.
4. **Verify emitter output is identical.** The generated `contract.d.ts` must be byte-identical before and after the refactor (modulo formatting). Use the demo contract and parity fixtures as regression tests.

This phase is independent of Phase 4 (IR alignment) and can be done before or after it.

## Non-Functional Requirements

- **Zero breakage during Phase 1.** All existing tests, the demo app, and downstream consumers must continue working without modification when Phase 1 lands. `validateContract()` bridges the new JSON structure to the old consumer-facing type.
- **Incremental migration.** Phase 2 changes should be deployable consumer-by-consumer, not as a single atomic switch.
- **Type safety throughout.** The widened `ContractBase` must provide typed access to domain fields. Consumers switching from old fields to new ones should get equivalent or better type inference.

## Non-goals

- **Mongo emitter.** This project updates the SQL emitter. A Mongo emitter is a separate project.
- **Value objects section.** Designing the contract representation for value objects is out of scope. The domain structure carries `models` only.
- **Change streams / subscriptions.** Runtime lifecycle changes are not in scope.
- **PSL/DSL authoring changes.** The authoring surface adapts to the new IR (Phase 4) but designing new authoring syntax is out of scope.

# Acceptance Criteria

### Phase 1: New contract structure

**Emitted JSON:**

- [ ] The SQL emitter produces `contract.json` matching ADR 172's structure: `roots`, `models` with `{ nullable, codecId }` fields, `model.relations` (model-keyed), `model.storage`
- [ ] Demo and test fixture `contract.json` files reflect the new structure

**Types:**

- [ ] `ContractBase` has typed `roots`, `models` (with `fields: Record<string, { nullable, codecId }>`, `relations`, optional `discriminator`/`variants`/`base`), declared in the framework core package
- [ ] `SqlContract extends ContractBase` with SQL-specific storage and retains old consumer-facing fields (`mappings`, top-level `relations`, `model.fields` with `{ column }`)
- [ ] Emitted `contract.d.ts` includes both old and new field shapes

**Validation:**

- [ ] `validateContract()` parses the new JSON structure and returns the widened type, populating old fields (e.g., `mappings`) from new structure (e.g., `model.storage`)
- [ ] Shared domain validation (roots, variants, relations, discriminators, orphans) runs as part of SQL `validateContract()`

**No consumer changes:**

- [ ] The ORM client, query builder, and contract authoring surfaces are not modified
- [ ] All existing tests pass without modification

### Phase 2: Migrate consumers

- [ ] The ORM client reads field types from `model.fields[f].codecId` and `model.fields[f].nullable`, not from the storage layer
- [ ] The ORM client reads field-to-column mappings from `model.storage.fields`, not from `mappings`
- [ ] The ORM client reads relations from `model.relations`, not from the top-level `relations` block
- [ ] No consumer imports or reads from the `mappings` section
- [ ] No consumer reads relations from the top-level `relations` block

### Phase 3: Remove old type fields

- [ ] `mappings` is removed from `SqlContract` and the `validateContract()` derivation logic
- [ ] Top-level `relations` type field is removed from `SqlContract` and `validateContract()`
- [ ] Old model field shape (`{ column: string }` without `nullable`/`codecId`) is removed from the type
- [ ] `contract.d.ts` emission reflects the final shape (no old fields)

### Phase 4: IR alignment

- [ ] `ContractIR` mirrors the emitted contract JSON structure (domain/storage separation, model-level relations, `roots`)

### Phase 5: Emitter generalization

- [ ] `TargetFamilyHook` no longer has a monolithic `generateContractTypes()` — domain-level type generation lives in the framework `emit()`
- [ ] The SQL hook provides only storage-specific type generation (`generateStorageType`, `generateModelStorageType`) and family-specific validation
- [ ] Generated `contract.d.ts` output is identical before and after the refactor (regression-tested against demo and parity fixtures)
- [ ] A new family emitter (e.g., Mongo) would not need to duplicate domain-level type generation logic

# Other Considerations

## Security

No security implications — this is an internal structural refactor of build artifacts and types.

## Cost

No cost implications — no new infrastructure, no runtime performance changes.

## Observability

No observability changes needed. The contract structure is a build-time artifact.

## Coordination

- **Alexey (ORM client):** Phase 2 requires migrating the ORM client to read from new type fields. Phase 1 adds new fields alongside old ones on the TypeScript type, so Alexey can switch call sites incrementally at his pace. No changes required from him until Phase 2.
- **Alberto (DSL/authoring):** Phase 4 updates the Contract IR he targets. This should be coordinated but is not a synchronous dependency — the emitter can produce the new contract JSON from the old IR during Phases 1–3. Phase 4 aligns the IR for his benefit.
- **Demo app and test fixtures:** `contract.json` files are updated in Phase 1 to the new structure. Since `validateContract()` bridges to the old type, everything continues to work.

# References

- [ADR 172 — Contract domain-storage separation](../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) — the target contract structure
- [ADR 174 — Aggregate roots and relation strategies](../../docs/architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — `roots` section design
- [10. MongoDB Family](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — design principles, contract examples
- [cross-cutting-learnings.md](../../docs/planning/mongo-target/cross-cutting-learnings.md) — domain model design principles
- [contract-symmetry.md](../../docs/planning/mongo-target/1-design-docs/contract-symmetry.md) — Mongo/SQL convergence analysis
- Current `ContractBase`: `packages/1-framework/1-core/shared/contract/src/types.ts`
- Current `SqlContract`: `packages/2-sql/1-core/contract/src/types.ts`
- Current SQL `validateContract()`: `packages/2-sql/1-core/contract/src/validate.ts`
- Extractable domain validation: `packages/2-mongo-family/1-core/src/validate-domain.ts`
- Current emitted contract: `examples/prisma-next-demo/src/prisma/contract.json`

# Open Questions

1. `**model.storage.fields` shape for SQL.** ADR 172 shows `"fields": { "id": { "column": "id" } }`. Should `model.storage.fields` carry any additional info beyond the column name (e.g., the nativeType, to avoid a second lookup into the top-level storage section)? **Default assumption:** Keep it minimal — just `{ column: string }`. The top-level `storage.tables` section is the source of truth for column metadata.
2. **Relation join details in `model.relations`.** The current top-level relations use `childCols`/`parentCols`. ADR 172 uses `on: { localFields, targetFields }`. Should the new `model.relations` use the ADR 172 naming (`localFields`/`targetFields`) or keep the existing naming for continuity during migration? **Default assumption:** Use the ADR 172 naming. The old top-level block coexists during Phase 2, so consumers can migrate at their own pace.
3. **Where does `roots` come from during emission?** Currently, every model with a `storage.table` is implicitly a root. Should the emitter derive `roots` automatically (every model → a root entry with pluralized name), or should the authoring surface declare them? **Default assumption:** The emitter derives `roots` from the existing model/table mapping for now. Explicit authoring-level `roots` is a DSL concern for Phase 4 / Alberto's workstream.
4. `**model.relations` with `strategy`.** The new relations include `"strategy": "reference" | "embed"`. For SQL, all relations are `"reference"` (no embedding). Should the SQL emitter include `"strategy": "reference"` on every relation, or omit it since it's the only option? **Default assumption:** Include it explicitly — the domain structure should be self-describing, and consumers shouldn't need to know "SQL means reference."

