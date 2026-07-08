---
from: "0.14"
to: "0.15"
changes:
  - id: relation-from-to-arguments
    summary: |
      The PSL `@relation` foreign-key arguments are renamed: `fields:` becomes `from:`
      and `references:` becomes `to:`. The legacy spellings are rejected at contract
      emission with PSL_LEGACY_FIELDS_REFERENCES. Rename the keys in place inside every
      `@relation(...)` attribute — argument order and values are unchanged. `@@id(fields:)`
      / `@@unique(fields:)` / `@@index(fields:)` are NOT affected; only `@relation` renames.
      Two new conveniences are available but not required: a single field may be written
      bare (`from: userId` instead of `from: [userId]`), and `to:` may be omitted entirely
      when the relation references the target model's `@id` (`@relation(from: userId)`).
    detection:
      glob: "**/*.prisma"
      contains:
        - "@relation"
      anyMatch: true
  - id: relation-name-pointer-disambiguation
    summary: |
      `@relation(name:)` and the positional relation name (`@relation("...")`) are
      rejected at contract emission with PSL_LEGACY_RELATION_NAME. Replace name-based
      relation pairing with pointer disambiguation: on a 1:N back-relation list field,
      name the owning FK-side relation field with `inverse:` (e.g. `posts Post[]
      @relation(inverse: author)`); on a many-to-many list field, name the junction
      with `through:` (e.g. `tags Tag[] @relation(through: PostTag)`) and, for
      self-relations or multiple many-to-many between the same pair of models, pin the
      parent-side junction relation field with the qualified form
      (`through: Follow.follower`). Relations that are unambiguous without a name
      simply drop the argument.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@relation("
      anyMatch: true
---

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

No consumer-facing action is required for this transition.

The diff under `examples/` (and the example migration snapshots) is incidental —
emitted contract artefacts (`contract.json` / `contract.d.ts`) were regenerated
for two internal substrate changes:

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

No user action — a re-emit picks up the new contract shape.

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
