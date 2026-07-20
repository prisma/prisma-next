---
from: "0.14"
to: "0.15"
changes:
  - id: sql-orm-includes-decode-codec-values
    summary: |
      SQL ORM includes now decode every scalar child field through its contract-bound codec, matching top-level query results. Update application code and tests that relied on included fields retaining the database's JSON representation: for example, Postgres `bytea` include fields now return `Uint8Array` instead of `\\x`-prefixed hex text, and timestamp include fields return `Date` instead of timestamp strings. Custom codec-backed include fields likewise return the value produced by the codec's `decodeJson` method.
  - id: db-verify-json-single-issue-list
    summary: |
      `prisma-next db verify --json` (and `db verify --schema-only --json`) now report a single
      `schema.issues` array instead of the split `schema.issues` / `schema.schemaDiffIssues`
      pair — the one-differ-two-ir-planner slice unified the CLI's schema-issue vocabulary onto
      one shape: `{ path, reason, message, expected?, actual? }`. `reason` replaces the retired
      `outcome` field (`'missing'` -> `'not-found'`, `'extra'` -> `'not-expected'`, `'mismatch'`
      -> `'not-equal'`). The same collapse applies to `schema.warnings`. If a script or CI step
      parses `db verify --json` output and reads `schema.schemaDiffIssues` /
      `schema.warnings.schemaDiffIssues`, or compares an issue's `.outcome` field, update it:
      read `schema.issues` (it already carries everything the two lists used to, concatenated)
      and switch any `.outcome` comparison to the matching `.reason` value.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,sh}"
      contains:
        - "schemaDiffIssues"
        - ".outcome === 'missing'"
        - ".outcome === 'extra'"
        - ".outcome === 'mismatch'"
      anyMatch: true
  - id: policy-target-models-require-rls-attribute
    summary: |
      RLS enablement is now an explicit, authored table attribute: a `policy_select` block's
      `target` model must declare `@@rls`, or `prisma-next contract emit` fails with
      `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` naming the model and the policy. Add
      `@@rls` to every policy-bearing model and re-run `prisma-next contract emit`; the
      re-emitted `contract.json` gains an `rls` marker entity and a new storage hash. Plan
      semantics follow the marker, not the policy set: a marked table with RLS off plans
      `ENABLE ROW LEVEL SECURITY` (even with policies in sync), removing every policy keeps
      RLS enabled (fail-closed deny-all), removing `@@rls` itself plans
      `DISABLE ROW LEVEL SECURITY` (requires the destructive allowance), and changing only a
      policy's name prefix plans a single `ALTER POLICY ... RENAME TO` instead of drop+create.
    detection:
      glob: "**/*.prisma"
      contains:
        - "policy_select"
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
      schemas that use `Json` and mean jsonb storage (which every pre-0.15 `Json` field did)
      must switch those fields — and `types {}` aliases — to `Jsonb`, then re-run
      `prisma-next contract emit`; with `Jsonb` the emitted `contract.json` is byte-identical
      to the pre-0.15 output. A field left as `Json` now emits a native `json` column and a
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
      the only storage decider. Pre-0.15, a generator default on a bare `String` field re-picked
      the column's storage to a sized char: `String @default(uuid())` / `@default(uuid(7))`
      emitted `sql/char@1` / `character(36)`, `@default(cuid(2))` `character(24)`,
      `@default(nanoid())` `character(21)` (or `character(<size>)` for `nanoid(<size>)`), and
      `@default(ulid())` `character(26)`. From 0.15 such fields emit the target's `String`
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
TML-2501 (extension-supabase slice B close-out, this PR): test-only. The only
`examples/` touch is `examples/supabase/test/rls-role-binding.integration.test.ts`:
the acceptance test's fixture no longer hand-applies `ENABLE ROW LEVEL SECURITY` /
`CREATE POLICY` SQL — the test now exercises exactly the policies `dbInit` applies
from `contract.prisma`, and gains a WITH CHECK assertion (reassigning an owned row
to another owner is rejected). No framework surface, contract shape, or emitted
artefact changes. No user action required. Incidental substrate diff only.
-->

<!--
TML-2870 (Postgres RLS slice 4: all policy operations + roles): additive. The
PSL RLS surface gains the non-select policy keywords `policy_insert`,
`policy_update`, `policy_delete`, and `policy_all`, each with an optional
`withCheck` predicate (per-operation predicate matrix enforced at load time),
alongside the existing `policy_select`. Postgres database roles also enter
`db verify`: a role a contract declares but the live cluster lacks fails verify
under every control policy, while an undeclared live role is tolerated
unconditionally (the framework references but does not own the cluster's role
list). Both are opt-in and additive — existing schemas that use only
`policy_select` (or no `policy_*` blocks) emit and verify byte-identically, and
no contract declares a role today unless authored to. The only `examples/`
touch is the `examples/supabase` walking skeleton: `Profile` gains an `anon`
public-read policy and an `authenticated` UPDATE-own policy (`using` +
`withCheck`), its `contract.json`/`contract.d.ts` regenerate, and the
integration tests extend to prove WITH CHECK enforcement under `SET ROLE` and
role verify. No user upgrade action — a re-emit picks up any contract shape.
Incidental substrate diff only.
-->

<!--
Postgres-RLS slice 2.5 (one-differ-two-ir-planner), final unit: retires the
coordinate-based issue vocabulary (`BaseSchemaIssue` / `SchemaIssue` /
`EnumValuesChangedIssue` / the legacy `outcome` field) now that the migration
planner and `db verify` both run on the one node-typed differ. The only
`examples/` touch is `examples/supabase/test/skeleton.integration.test.ts`,
which read a verify result's `schema.schemaDiffIssues` list and an issue's
`.outcome` field directly — updated to `schema.issues` and `.reason` per the
`db-verify-json-single-issue-list` entry above. Superseds the "internal
refactor... not a stable shipped API" framing of the TML-2931 entry below: the
JSON shape is now settled and consumer-facing action is required for the
collapse.
-->

<!--
TML-2891 (eliminate the SQL family placeholder namespace): app authors who build
contracts through the public facades / target `defineContract` wrappers
(`@prisma-next/postgres`, `@prisma-next/sqlite`) are unaffected — those wrappers
supply the now-required `createNamespace` factory, so no app-author code changes.
The only `examples/` diff is regenerated migration `end-contract.d.ts` snapshots
whose SQL namespace `kind` changed from `'sql-namespace'` to `'postgres-schema'`;
the next `contract emit` picks this up automatically, and historical migration
snapshots are type-only (the runtime reads `contract.json`, which already carried
`postgres-schema`). No app-author action. Incidental substrate diff only.
-->

<!--
TML-2868 (Postgres RLS slice 1): adds the additive Postgres row-level-security
authoring feature (PSL `policy_select` blocks lower to RLS policies; `db verify`
diffs them, scoped to the namespaces a contract owns). The `examples/supabase/*`
touches — re-emitted `contract.json` / `contract.d.ts` / `contract.prisma`, the
`profile-queries.ts` demo, and the `skeleton.integration.test.ts` walking
skeleton — only demonstrate the new feature plus merge regeneration. RLS is opt
in; existing schemas without `policy_*` blocks emit and verify unchanged. No user
upgrade action — re-emit picks up the contract shape. Incidental substrate diff
only.
-->

<!--
TML-2931 (Postgres RLS migration seam): internal refactor of how the RLS schema
diff is represented — policies nest under a table node, the framework differ keys
nodes by an `id()` path rather than an entity coordinate, and `SchemaDiffIssue`
carries `path` instead of `coordinate`. The only `examples/` touch is
`examples/supabase/test/skeleton.integration.test.ts`, which reads a diff issue's
subject differently (`issue.path` instead of `issue.coordinate`). The RLS
schema-diff surface is still in development (not a stable shipped API), and the
authored RLS feature behaviour is unchanged. No user upgrade action. Incidental
substrate diff only.
-->

<!--
TML-2795: the `prisma-next-demo` example gains a Post<->Tag many-to-many. The demo
authors the relation in PSL (with a re-baselined `add_post_tags` migration), switches
its id fields to native uuid storage for M:N parity, and adds M:N ORM examples, CLI
commands, seed data, and PGlite integration coverage. Demonstrates the many-to-many
authoring surface that slice 5 (TML-2794) added to the framework; the example diff
spans `examples/prisma-next-demo/**` only. Additive and opt-in — no existing consumer
contract changes shape and no migration is forced. No consumer action required.
Incidental substrate diff only.
-->

<!--
TML-2886 (redo, PR #841): type SQL enum columns via a baked storage column lookup.
The SQL emitter now generates a top-level `StorageColumnTypes` map keyed
`[namespace][table][column]`; `FieldOutputTypes`/`FieldInputTypes` are derived from
it at emit time. The query builder (sql-builder) reads `StorageColumnTypes` directly;
the ORM still reads `FieldOutputTypes`. `contract.json` and both hashes are
byte-identical; `FieldOutputTypes` is byte-identical to main. The examples/ diff is
purely `.d.ts` regeneration (the new `StorageColumnTypes` block added; observable
types unchanged). No consumer action required. Incidental substrate diff only.
-->

<!--
TML-2884 (PR #834): end-to-end MongoDB enum enforcement via `$jsonSchema`.
The `mongo-demo` example gains a `UserRole` enum field (`role` on `users`),
authored in both PSL and the TypeScript builder. The planner-generated migration
applies a `collMod` with a `$jsonSchema` validator that enforces the enum values
at the MongoDB layer. Three migration `end-contract.d.ts` / `start-contract.d.ts`
snapshots were also updated for the TML-2891 `'mongo-namespace'` → `'mongo-database'`
kind rename. Re-emit picks up the new contract shape automatically; no consumer
action required. Incidental substrate diff only.
-->

<!--
TML-2503 (extension-supabase slice D): the `examples/supabase` diff adds two new
integration/type tests exercising the additive `db.asServiceRole().supabase.{sql,orm}`
admin surface — a secondary root for reading Supabase-internal `auth.*`/`storage.*`
tables as `service_role`. App authors are unaffected: the admin root is additive, and
the primary `db.asServiceRole().sql`/`.orm` surface (plus `asUser`/`asAnon`) is
unchanged. No user action. Incidental substrate diff only.
-->

<!--
TML-2892 (PR #879): the `Migration` base now takes the migration's start/end
contract JSON as typed inputs and derives `describe()` from their `storage.storageHash`,
and generated migrations use `Migration<Start, End>` with `endContractJson`/
`startContractJson` fields instead of hand-written from/to hashes; the base exposes
typed `this.startContract`/`this.endContract` ContractViews for the (hand-authored)
data-transform case. Every example `migration.ts` is regenerated to this shape; the
`operations` bodies are preserved verbatim, so `ops.json`/`migration.json` and every
emitted contract are byte-identical. No consumer action — re-scaffold via
`migration plan` picks up the new shape. Incidental substrate diff only.
-->

# Upgrade 0.14 → 0.15

Consumer actions for this transition are recorded in the `changes[]` entries in
the frontmatter above.

Beyond those, the diff under `examples/` (and the example migration snapshots)
is incidental — emitted contract artefacts (`contract.json` / `contract.d.ts`)
were regenerated for two internal substrate changes:

- **Scalar-list storage machinery.** The emitted contracts now carry the
  adapter-reported `scalarList` capability marker and the bumped envelope
  version. The scalar-list machinery threaded through this release is internal —
  no authoring path emits a list storage column yet, so generated types and
  runtime behaviour for existing schemas are unchanged.
- **Namespace-scoped execution-default refs (M:N).** The contract's
  `ExecutionMutationDefault.ref` now carries a `namespace` alongside `table` and
  `column`, so an execution-time mutation default is keyed by
  `(namespace, table, column)`, disambiguating same-named tables across
  namespaces. The runtime applies defaults by namespace transparently.

Both regenerations are picked up by re-running `prisma-next contract emit`.

<!--
Exercise Mongo enums in retail-store (this PR): the retail-store example replaces
order-type string literals with typed enum accessors via `buildNamespacedEnums` from
`@prisma-next/contract/enum-accessor`. The `MongoClient` facade also gains a direct
`db.execute(plan)` method and a `db.raw` property (both additive). None of these
changes affect the emitted contract shape; a re-emit picks them up automatically.
No user action required. Incidental substrate diff only.
-->

<!--
TML-2954 (reshaping-pipeline decode): the Mongo query builder now reifies a per-stage
result shape, so reads through reshaping aggregation stages (`$project`/`$addFields`,
with more stages to follow) decode their output fields through the contract codecs
instead of returning raw BSON. Previously any reshaping stage collapsed the plan to an
un-decoded pass-through — a projected `_id` came back as a raw `ObjectId`; it now comes
back decoded, matching the row type the builder already declared. `$vectorSearch`
(shape-preserving) is reclassified as identity, so the retail-store `findSimilarProducts`
example drops its `db.raw` + `blindCast` for the typed builder. This is a runtime
behaviour fix — no API or contract-shape change and no re-emit needed; code that relied
on the previous un-decoded values would now observe decoded ones. Incidental to emit.
-->

<!--
TML-2955 (expose the static ExecutionContext symmetrically): additive client-safe
static surface. New `@prisma-next/{mongo,postgres,sqlite}/static` entrypoints export
`<target>Static({ contractJson })`, returning the driver-free `ExecutionContext`
plus derived `enums` / query builder / `raw` / `contract`; the facades also expose
`db.context` (Mongo now typed `MongoExecutionContext<TContract>`) and `db.contract`.
All additive — existing app code is unaffected. The `retail-store` example's
`src/enums.ts` switches from the interim `buildNamespacedEnums` + `blindCast` to
`mongoStatic(...).enums` (example-internal). No user action required. Incidental
substrate diff only.
-->

<!--
TML-2952 (this PR): route SQL enum/value-set column TS typing through the codec.
A field/column restricted to a value set now derives its narrowed TS literal union
by rendering each stored value through its codec, replacing the framework's
(now-deleted) domain-enum override. The only `examples/` touch is a type test —
`examples/prisma-next-demo/test/demo-dx.types.test.ts` — asserting the emitted
`FieldOutputTypes` enum field equals the no-emit `typeof contract` value union
(emit-vs-no-emit agreement). The emitted contract is byte-identical (`fixtures:check`
clean; `contract.json`, `contract.d.ts`, and both hashes unchanged). No user action
required. Incidental substrate diff only.
-->

<!--
Slow-query warning middleware example (PR #912): the `prisma-next-demo` example
gains a `slowQueryWarning` custom middleware (`src/prisma/slow-query-warning.ts`,
wired into the runtime `middleware: [...]` chain in `src/prisma/db.ts`, with
offline unit tests). Documentation-driven example code only — it exercises the
existing public `SqlMiddleware` `afterExecute` hook and changes no framework
surface, contract shape, or emitted artefact. No user action required.
Incidental substrate diff only.
-->

<!--
TML-2953 (this PR): Mongo enum fields now type through a storage value set, the same
way SQL does. Authoring a Mongo enum writes a value set into
`contract.storage.namespaces[<ns>].entries.valueSet[<Enum>]` (the codec-encoded
member values) alongside the domain enum, and the emit typing + `$jsonSchema`
validator source from it. The `mongo-demo` and `retail-store` example contracts
regenerate to carry the value set (`contract.json` gains `entries.valueSet` and its
`storageHash` updates); the emitted `contract.d.ts` field types and the `$jsonSchema`
validator are byte-identical. `db.enums` runtime behaviour is unchanged. A re-emit
picks up the new `contract.json` shape; existing migrations are unaffected (the value
set is non-physical — no new migration op). No user action required. Incidental
substrate diff only.
-->

<!--
TML-2976 (native Postgres enums, external Supabase types — this PR): adds external
native Postgres enum support — Postgres `CREATE TYPE ... AS ENUM` types the database
already owns (e.g. Supabase's `auth.aal_level`), represented via a `native_enum` PSL
entity, typed as a value union, and read at runtime through a Postgres-only
`db.nativeEnums` accessor. The `examples/` diff is additive:
- `examples/supabase` gains `src/session-queries.ts` and
  `test/native-enum-session.integration.test.ts` (reading `auth.aal_level`), plus a
  regenerated `src/contract.d.ts`.
- `examples/prisma-next-demo` and `examples/retail-store` switch their enum
  value-union annotations from `EnumValues<Db['enums'][X]>` to the equivalent `.Value`
  phantom (`Db['enums'][X]['Value']`). `EnumValues` is unchanged and still exported;
  `.Value` is the new preferred form, so this is an optional style adoption, not a
  forced migration.
Native enums are opt-in — existing schemas without a `native_enum` emit and run
unchanged, and a re-emit picks up any contract shape. No user action required.
Incidental substrate diff only.
-->

<!--
Dependabot runtime-deps group bump (PR #962): runtime dependency version
bumps only (arktype 2.2.x, prettier 3.9.4, pg 8.22, pg-cursor 2.21, next
16.2.10, react-router 7.18, radix/tailwind patches and friends), plus a
`pnpm dedupe arktype` so every workspace package resolves the same arktype
instance (the split 2.2.2/2.2.3 resolution broke cross-package `Type`
assignability). The `examples/` diff is package.json dependency version
ranges only — no framework surface, contract shape, or emitted artefact
changes. No user action required. Incidental substrate diff only.
-->
