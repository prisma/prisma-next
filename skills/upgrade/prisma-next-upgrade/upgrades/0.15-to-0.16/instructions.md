---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`). The import typechecked (types shipped in `dist`), but the
      subpath never worked from npm — the shim reads fixture `.sql` files that were never
      published, so every call failed with ENOENT before touching a database. There is no
      working code to migrate: delete the import and whatever test setup called
      `bootstrapSupabaseShim`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      contains:
        - "extension-supabase/test/utils"
      anyMatch: true
  - id: scalar-type-descriptors-channel-removed
    summary: |
      The scalar-type descriptor channel is retired in favour of the unified authoring type
      namespace. Projects with custom control-stack setups that import
      `createPostgresScalarTypeDescriptors` / `createSqliteScalarTypeDescriptors`, or that read
      `scalarTypeDescriptors` from a control stack or contract-source context, must migrate:
      those exports are deleted, and scalar types are now zero-arg type-constructor
      contributions in the component's `authoring.type` namespace — e.g.
      `String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } }`.
      Read the scalar type names via `stack.scalarTypes`, or the full name ->
      `{ codecId, nativeType }` map via `collectScalarTypeConstructors(stack.authoringContributions.type)`
      from `@prisma-next/framework-components/authoring`. Standard target setups
      (`@prisma-next/postgres`, `@prisma-next/sqlite`) supply the contributions themselves.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "createPostgresScalarTypeDescriptors"
        - "createSqliteScalarTypeDescriptors"
        - "scalarTypeDescriptors"
      anyMatch: true
  - id: postgres-json-rebound-to-native-json
    summary: |
      On the postgres target the PSL `Json` scalar re-binds from `pg/jsonb@1` / `jsonb` to
      `pg/json@1` / `json`; a new bare `Jsonb` scalar carries `pg/jsonb@1` / `jsonb`. Postgres
      schemas that use `Json` and mean jsonb storage (which every pre-0.16 `Json` field did)
      must switch those fields — and `types {}` aliases — to `Jsonb`, then re-run
      `prisma-next contract emit`; with `Jsonb` the emitted `contract.json` is byte-identical
      to the pre-0.16 output. A field left as `Json` now emits a native `json` column and a
      new storage hash, which against an existing jsonb database is a schema change. The
      legacy `@db.Json` attribute path is unchanged (`Json @db.Json` still yields
      `pg/json@1` / `json`), and sqlite/mongo `Json` bindings are untouched. The TS builder
      surface (`field.json()`, `jsonbColumn`) is unchanged and stays jsonb.
    detection:
      glob: "**/*.prisma"
      contains:
        - "Json"
      anyMatch: true
  - id: default-generators-no-longer-set-storage
    summary: |
      `@default(<generator>)` no longer influences a column's storage — the type position is
      the only storage decider. Pre-0.16, a generator default on a bare `String` field re-picked
      the column's storage to a sized char: `String @default(uuid())` / `@default(uuid(7))`
      emitted `sql/char@1` / `character(36)`, `@default(cuid(2))` `character(24)`,
      `@default(nanoid())` `character(21)` (or `character(<size>)` for `nanoid(<size>)`), and
      `@default(ulid())` `character(26)`. From 0.16 such fields emit the target's `String`
      storage (postgres: `pg/text@1` / `text`) with the same execution-time generator, so a
      re-emit produces a new storage hash — against an existing database created with the char
      storage this is a schema change. To keep the prior storage byte-identical, name it in the
      type position: `Char(36) @default(uuid())`, `Char(24) @default(cuid(2))`,
      `Char(21) @default(nanoid())` (or `Char(<size>)` for a sized nanoid), `Char(26)
      @default(ulid())` — or adopt native `Uuid` for `uuid()` if a `uuid`-typed column is
      preferred (that is a schema change too). Then re-run `prisma-next contract emit` and, if
      you accepted a storage change, plan/apply the matching migration. Generator applicability
      validation is unchanged (`uuid()` on `Int` still fails with
      `PSL_INVALID_DEFAULT_APPLICABILITY`), and the TS builder presets
      (`field.id.uuidv4String()`, `field.generated(uuidv4())`, …) are untouched — they bundle
      their `char(N)` storage explicitly.
    detection:
      glob: "**/*.prisma"
      contains:
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
`foreignKeyDefaults`). Every FK-bearing `contract.json` / `contract.d.ts` in the
repo re-emits to the new shape (the `examples/` diff is that regeneration); a
downstream `contract emit` picks it up automatically with no source change. The
only caller-visible break is TypeScript that reads `.constraint` / `.index` off a
contract's `foreignKeys[]` entry (contract internals, not an app-authoring
surface) — those fields are gone; read the discrete `indexes[]` entry instead. No
migration or DDL change: the schema the planner and `db verify` derive is
identical.
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The `examples/` touch is
`examples/supabase/README.md` — a link into the deleted
`projects/supabase-integration/` workspace removed. No framework surface,
contract shape, or emitted artefact change. Incidental substrate diff only.
-->

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate via the presence of `expected`/`actual`, or the exported
`issueOutcome(issue): ExpectationFailureReason` helper. `ExpectationFailureReason`
keeps its `'not-found' | 'not-expected' | 'not-equal'` values and its export path;
it is now the helper's return type rather than the removed field's type. This is a
framework migration-control internal, not an app-authoring surface. The
`examples/` diff is supabase-example TEST assertions updated from `.reason` to
presence — no runtime, contract, or DDL change. Incidental test-only diff.
-->

<!--
Supabase example env template (TML-2503): docs-only. The `examples/` touch adds
`examples/supabase/.env.example`, naming the two env vars the real-Supabase
acceptance lane already reads (`DATABASE_URL`, `SUPABASE_JWT_SECRET`). Nothing
loads the file — it documents what to export. No framework surface, contract
shape, or emitted artefact change. Incidental substrate diff only.
-->

<!--
Dependabot dev-deps group bump (PR #961): dev-dependency version bumps only
(biome 2.5.2, wrangler, @types/react, @cloudflare/* and friends), plus the
biome.jsonc schema-version alignment and the handful of code sites biome 2.5
newly flags (useOptionalChain / noProto in tests). The `examples/` diff is
package.json devDependency version ranges and biome.jsonc schema versions only —
no framework surface, contract shape, or emitted artefact changes. No user
action required. Incidental substrate diff only.
-->
