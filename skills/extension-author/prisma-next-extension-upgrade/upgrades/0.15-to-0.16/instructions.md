---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`), and it is no longer a pattern to copy for extension test
      tooling. The import typechecked (types shipped in `dist`), but the subpath never worked
      from npm — the shim reads fixture `.sql` files that were never published, so every call
      failed with ENOENT before touching a database. Delete any import of
      `@prisma-next/extension-supabase/test/utils`; keep hermetic test helpers package-internal
      (tests import them by source path) rather than publishing them as subpath exports whose
      on-disk fixtures don't ship.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      contains:
        - "extension-supabase/test/utils"
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

<!--
TML-3027 (foreign keys and indexes are discrete contract entities): emitted
contract-shape change. `contract emit` now materializes the per-FK `constraint`/
`index` authoring booleans into discrete entities — a `foreignKeys[]` entry is the
referential constraint only (no `constraint`/`index` fields), and every backing
index (including one backing a FK) is its own named `indexes[]` entry. The booleans
remain as authoring input (`@relation(index:)`, TS `fk({ constraint, index })`,
`foreignKeyDefaults`). An extension whose contract declares FKs re-emits to the new
shape on the next `contract emit`, with no authoring change. Extension code that
reads `.constraint` / `.index` off a contract's `foreignKeys[]` entry (e.g. custom
migration/verify logic or a hand-built contract fixture) must drop those fields and
read the discrete `indexes[]` entry instead. No SPI or DDL change: the schema-IR the
planner and `db verify` derive is identical. (The `packages/3-extensions/` diff is
pgvector test fixtures updated to the new FK literal shape.)
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The
`packages/3-extensions/` touch is `packages/3-extensions/supabase/README.md` —
links into the deleted `projects/supabase-integration/` workspace re-pointed at
ADR 237 (the service_role secondary-root decision) or inlined as plain text.
No SPI, contract shape, or emitted artefact change. Incidental substrate diff
only.
-->

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate a diff issue via the presence of `expected`/`actual`, or the
exported `issueOutcome(issue): ExpectationFailureReason` helper from
`@prisma-next/framework-components/control`. `ExpectationFailureReason` keeps its
`'not-found' | 'not-expected' | 'not-equal'` values and its export path; it is now
the helper's return type rather than the removed field's type. This is a framework migration-control
internal, not an extension-authoring SPI. The `packages/3-extensions/` diff is
supabase-extension TEST assertions updated from `.reason` to presence — no runtime,
contract, SPI, or DDL change. Incidental test-only diff.
-->

<!--
TML-2783 (explicit MTI selections): `changes: []`. The `packages/3-extensions/sql-orm-client` diff is limited to internal polymorphic projection planning and regression tests; it changes no public API, contract/emitted artifact, extension-authoring surface, adapter API, or downstream source translation.
-->

<!--
Dependabot dev-deps group bump (PR #961): `changes: []`. The
`packages/3-extensions/` diff is biome.jsonc schema-version alignment for the
biome 2.5.2 dev-dependency bump plus the code sites biome 2.5 newly flags
(useOptionalChain in `sql-orm-client/src/collection.ts`); no SPI, contract
shape, emitted artefact, or extension-authoring surface change. Incidental
substrate diff only.
-->
