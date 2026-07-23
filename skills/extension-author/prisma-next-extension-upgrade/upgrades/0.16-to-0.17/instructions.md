---
from: "0.16"
to: "0.17"
changes:
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) into a single content-addressed store per migrations
      root, at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      where `<hex>` is the contract's storage hash with the `sha256:` prefix
      stripped. Every distinct contract is stored once, however many migrations
      reference it. An extension source repo keeps the shallow layout — migration
      packages sit directly under `migrations/` (no `app/` segment), so its store
      is `migrations/snapshots/` at the same depth, and every emitted
      `migration.ts` imports its bookend contracts one level up:
      `../snapshots/<hex>/contract.json` / `../snapshots/<hex>/contract.d.ts`
      (a consuming project's `app/`-nested migrations import two levels up,
      `../../snapshots/...` — do not copy that depth into an extension repo).
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade your extension's tooling — `migration plan` /
      `migration new` / `migration check` all read contract snapshots through the
      store only, and a missing store entry fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path.
      `migration.json` / `ops.json` / `migrationHash` are unaffected — the
      contract snapshot was never part of migration identity, so converting the
      layout changes no migration's hash, and no extension-authoring SPI changes.
      To convert an existing extension repo, run the migrator once from a
      checkout of the `prisma/prisma-next` repository at (or above) the version
      you're upgrading to, pointed at your extension's migrations root:
      `node scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`.
      Per migration package, it reads `migration.json`, write-if-absents the
      destination contract (and the source contract, when present) into the
      store under the matching hash, rewrites the committed `migration.ts`
      import specifiers, and deletes the four sibling files. It asserts every
      contract's inner `storage.storageHash` against the hash it's filed under
      before writing anything (mismatch aborts the whole run, nothing is
      deleted), and re-verifies every `migrationHash` is unchanged after
      conversion. Run it, review the diff, then typecheck your extension package
      to confirm every rewritten `migration.ts` import resolves.
    detection:
      glob: "**/migration.ts"
      contains:
        - "./start-contract.json"
        - "./end-contract.json"
        - "./start-contract'"
        - "./end-contract'"
      anyMatch: true
  - id: ref-paired-snapshots-moved-to-content-addressed-store
    summary: |
      Ref-paired contract snapshot files (`refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts`) are no longer written or read. A ref is now
      only its pointer file, `refs/<name>.json` (`{ hash, invariants }`); the
      contract it names resolves through the same content-addressed store as
      every migration graph node, `migrations/snapshots/<hex>/contract.json` +
      `contract.d.ts`, by that hash. Your extension repo's `migrations/refs/`
      normally carries only the system `head.json` pointer, which was never
      ref-paired — this only matters if your repo also carries named refs
      (e.g. from testing `ref set` against the extension's own migrations
      root). A pointer whose store entry is missing now fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path,
      rather than silently falling back to the migration graph. The same
      one-shot migrator that folds per-package sibling snapshots (see the
      entry above) also folds any existing `refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts` pairs: it write-if-absents the pair into the
      store under the sibling pointer's `hash`, then deletes the pair — the
      pointer file itself is read but never written, so it stays
      byte-identical. A `.contract.json` with no sibling pointer, or whose
      inner `storage.storageHash` disagrees with the pointer's `hash`, aborts
      the whole run before anything is written or deleted. Run `node
      scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`
      (same invocation as above; one run folds both migration-package and
      ref-paired snapshots), then review the diff.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: adopt-sql-json-projection-ast-foundations
    summary: Migrate relational AST construction and traversal to explicit JSON projection wrappers, expanded scalar-expression variants, grouped function-source aliases, and codec-preserving forwarded projections.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "JsonObjectExpr"
        - "JsonArrayAggExpr"
        - "ExprVisitor"
        - "AnyExpression"
        - "FunctionSource.of"
        - "ProjectionItem.of"
      anyMatch: true
  - id: scalar-type-descriptors-channel-removed
    summary: |
      `ComponentMetadata.scalarTypeDescriptors` is retired — the unified authoring type namespace
      is now the single channel for scalar types. If your extension/adapter descriptor declared
      `scalarTypeDescriptors: new Map([['String', 'pg/text@1'], ...])`, move each entry to a
      zero-arg type-constructor contribution in the descriptor's `authoring.type` namespace:
      `String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } }`.
      The `nativeType` is now explicit — it was previously derived from the codec's first target
      type, so check the codec manifest for the value to inline. Code that read
      `ControlStack.scalarTypeDescriptors` / `ContractSourceContext.scalarTypeDescriptors` should
      read `stack.scalarTypes` (the scalar type names) or derive the name ->
      `{ codecId, nativeType }` map via `collectScalarTypeConstructors(stack.authoringContributions.type)`
      from `@prisma-next/framework-components/authoring`. `assembleScalarTypeDescriptors` is
      deleted, and `validateScalarTypeCodecIds` now takes the authoring type namespace instead of
      a descriptor map.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "scalarTypeDescriptors"
        - "assembleScalarTypeDescriptors"
      anyMatch: true
  - id: postgres-json-rebound-to-native-json
    summary: |
      On the postgres target the PSL `Json` scalar re-binds from `pg/jsonb@1` / `jsonb` to
      `pg/json@1` / `json`; a new bare `Jsonb` scalar carries `pg/jsonb@1` / `jsonb`
      (`postgresScalarAuthoringTypes` in `@prisma-next/adapter-postgres`). Extension test
      schemas and fixtures that author postgres `Json` fields and mean jsonb storage must
      switch those fields to `Jsonb`; assertions that pin the `Json` name's derived binding
      (e.g. over `collectScalarTypeConstructors(stack.authoringContributions.type)` or
      `stack.scalarTypes`) now expect `Json -> { codecId: 'pg/json@1', nativeType: 'json' }`
      plus the new `Jsonb -> { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }` entry. PSL
      value-object storage columns still emit jsonb (the interpreter now prefers the target's
      `Jsonb` scalar and falls back to `Json`). The legacy `@db.Json` attribute path
      (`NATIVE_TYPE_SPECS`) is unchanged, as are sqlite/mongo `Json` bindings and the TS
      builder surface (`field.json()`, `jsonbColumn`).
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      contains:
        - "Json"
      anyMatch: true
  - id: default-generators-no-longer-set-storage
    summary: |
      `@default(<generator>)` never mutates a column's storage any more — the type position is
      the only storage decider — and the whole generator-storage-override SPI is retired with
      it. Removed surfaces: `MutationDefaultGeneratorDescriptor.resolveGeneratedColumnDescriptor`
      (`@prisma-next/framework-components/control`) — generator descriptors are now
      `{ id, applicableCodecIds?, buildPhases? }` only, and `applicableCodecIds` remains the
      validation channel (`PSL_INVALID_DEFAULT_APPLICABILITY` on mismatch); the transitional
      `baseScalar` marker on `AuthoringTypeConstructorDescriptor` and
      `ScalarTypeConstructorOutput` (`@prisma-next/framework-components/authoring`) — scalar
      type-constructor contributions and the derived scalar view are plain
      `{ codecId, nativeType, typeParams? }` again; and the `@prisma-next/ids` exports
      `resolveBuiltinGeneratedColumnDescriptor` / `GeneratedColumnDescriptor` (the TS spec
      helpers `uuidv4()`, `nanoid()`, … still return `GeneratedColumnSpec` bundling their
      explicit `sql/char@1` column). Packs that registered a generator descriptor with a
      storage-resolution hook must drop the hook; PSL schemas in extension fixtures relying on
      `String @default(uuid()/cuid()/nanoid()/ulid())` producing `character(N)` columns must
      either accept the target String storage (postgres: `pg/text@1` / `text`) or author the
      char storage explicitly in the type position (`Char(36) @default(uuid())`, …), then
      re-emit.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      contains:
        - "resolveGeneratedColumnDescriptor"
        - "resolveBuiltinGeneratedColumnDescriptor"
        - "baseScalar"
        - "@default(uuid("
        - "@default(cuid("
        - "@default(nanoid("
        - "@default(ulid("
      anyMatch: true

---

## `adopt-sql-json-projection-ast-foundations`

Relational JSON container AST construction now requires an explicit value-projection variant. Import `NativeJsonValueProjection` from `@prisma-next/sql-relational-core/ast` and wrap every expression that 0.16 code passed directly to `JsonObjectExpr.entry(key, expression)` or `JsonArrayAggExpr.of(expression, ...)`: use `JsonObjectExpr.entry(key, new NativeJsonValueProjection(expression))` and `JsonArrayAggExpr.of(new NativeJsonValueProjection(expression), ...)`. `NativeJsonValueProjection` preserves the pre-0.17 target-native JSON conversion. Use `CodecJsonValueProjection` only when the extension deliberately supplies a `CodecRef` for codec-owned JSON conversion, and use `JsonDocumentProjection` only when the wrapped expression already produces a JSON document.

`ExprVisitor<R>` and the `AnyExpression` union now include `FunctionCallExpr` (`kind: 'function-call'`), `CastExpr` (`kind: 'cast'`), and `CaseExpr` (`kind: 'case'`). Add `functionCall`, `cast`, and `case` methods to every visitor object, and add all three discriminants to exhaustive `expr.kind` switches. Binding or rewriting visitors should route these nodes through their normal recursive expression path; restricted visitors such as grouped `HAVING` validators should reject them explicitly when the context does not support them.

`FunctionSource.of(fn, args, alias)` now groups alias state so returned-column aliases cannot exist without a table alias. Replace a string third argument such as `FunctionSource.of(fn, args, 'rows')` with `FunctionSource.of(fn, args, { alias: 'rows' })`; when returned-column names are required, pass `{ alias: 'rows', columnAliases: ['value', 'ordinality'] }`. Calls that omit the alias remain unchanged.

When an extension forwards an existing `ProjectionItem` through a derived-table or row-number wrapper, preserve its known codec in the reconstructed projection: use `ProjectionItem.of(item.alias, ColumnRef.of(wrapperAlias, item.alias), item.codec)`. Leave the codec undefined only for computed or otherwise unknown projected results. After applying the applicable edits, run the extension's typecheck and tests; update AST-shape fixtures to assert the explicit wrapper nodes and preserved codec metadata.
