# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md) · **Designs:** [`specs/authoring-design.md`](specs/authoring-design.md), [`specs/querying-design.md`](specs/querying-design.md), [`specs/migration-design.md`](specs/migration-design.md)

## Status

Phase 1 (external enums) is **shipped** — [PR #906](https://github.com/prisma/prisma-next/pull/906). The forward work is Phase 2 (managed enums) and the TS authoring mirror, below. This plan is the work breakdown; the design is in [`spec.md`](spec.md).

## Shipped — Phase 1 (external enums, no DDL)

The complete external-enum vertical — represent → type → cast → runtime access → Supabase demonstration. Satisfies **R1–R5**. Design of record: [`spec.md`](spec.md); implementation is the commits below.

- **Representation, typing, cast, `db.nativeEnums`** (`cbb1f6e50` → `a105437f6`) — the `native_enum` pack entity + derived value-set; the `pg.enum(Ref)` column + `pg/enum@1` codec typed via the value-set → codec path; the per-column `$N::<type>` cast; the Postgres-only `db.nativeEnums` accessor. Satisfies R1–R4.
- **Supabase demonstration + schema-qualification fix** (`b8c4a69a7`, `1a3306cf4`) — the Supabase extension declares `auth.aal_level`; the example proves the whole path end-to-end against real Postgres. Running it for real exposed that a non-`public` schema needs a **schema-qualified** type reference (`auth.aal_level`) for both the cast and `db verify` — fixed by qualifying the column's `nativeType` by its namespace. Satisfies R5 and proves R1–R4 end-to-end.

## Forward work

### Generic namespace-`entries` serialization — in progress, [TML-2981]

- **Outcome:** the SQL contract serializer emits a namespace's entity kinds by iterating `entries` (symmetric with the already-generic hydrate path), so an extension-contributed kind round-trips with no serializer edit; byte-identical emitted output.
- **The work:** lift generic entries serialization into `SqlContractSerializerBase`; rewire the Postgres + SQLite serializers to delegate; `native_enum` stays excluded via non-enumerability. Slice spec: [`slices/generic-namespace-entries-serialization/spec.md`](slices/generic-namespace-entries-serialization/spec.md).
- **Origin:** review point O1 on PR #906.

### TS authoring mirror — in progress, [TML-2965]

- **Outcome:** a `native_enum` is authorable in the TS DSL (`nativeEnum(…)` + `field.column(pg.enum(handle))`), producing a contract byte-identical to the PSL version.
- **The work:** a generic **`ContractDefinition` pack-entity attachment** — route author-declared, namespace-scoped pack entities into `entries.<kind>` (+ derive their value-set) through the `defineContract` chain, following the `enums` wiring; a bespoke `nativeEnum(...)` handle + deferred `pg.enum(handle)` descriptor; and relocating type-name qualification out of the codec into a generic build-stage step (so a named schema like `auth` is authorable in TS). Slice spec: [`slices/native-enum-ts-authoring/spec.md`](slices/native-enum-ts-authoring/spec.md).
- **Follow-ups:** RLS `role`/`policy` TS wiring rides the same seam (unexercised here); the auto-composed generic `type.pg.enum` path repair is [TML-2983](https://linear.app/prisma-company/issue/TML-2983).
- **Proven by:** a PSL + TS byte-identical parity test.

### Parser `refKind` for entity-ref type-constructor arguments — deferred, [TML-2978]

- **Outcome:** the PSL parser / symbol table knows a type-constructor argument (e.g. `AalLevel` in `pg.enum(AalLevel)`) is a reference — enabling parse-time / LSP scope validation and editor navigation (go-to-definition / rename / autocomplete) on it.
- **Why deferred:** not a correctness dependency. The native-enum generic collapse ([`specs/native-enum-generic-collapse.md`](specs/native-enum-generic-collapse.md)) declares "argument is a ref" on the type-constructor descriptor and resolves it in the interpreter, so a bad reference is still rejected (at build time). This is the grammar/LSP layer on top — purely additive author ergonomics, and it lives in the PSL parser, a different area from the collapse. **Consider once the collapse and the Phase-1 critical path are complete.**

### Phase 2 — managed native enums (separate project; needs go-ahead)

Prisma Next creates and drops the type and migrates **add-value** in place. Satisfies **R6–R10**. Design: [`spec.md`](spec.md) § Phase 2 and [`specs/migration-design.md`](specs/migration-design.md). Three vertical slices, in order, each proven against a live database:

- **Slice A — create / delete (R7, R10).** The `PostgresNativeEnum` SchemaIR `DiffableNode` (identity on type name, equality over ordered members); introspection reading **ordered** values (`pg_enum.enumsortorder`); the Contract→SchemaIR projection into a new `PostgresSchemaIR.enumTypes` field; the generic differ reporting missing / extra / value-mismatch; and the `CREATE TYPE` / `DROP TYPE` ops, ordered before the columns that use the type. The `external`/`observed` grade suppresses drift, so shipped Phase-1 enums stay untouched.
- **Slice B — add value (R8, R9).** The order-aware diff — a pure suffix-append → `ALTER TYPE … ADD VALUE`; a rename, removal, or reorder is refused with a diagnostic and never lowered to an op — plus the `ADD VALUE` op, with its non-transactional caveat surfaced to the runner.
- **Slice C — adoption (R6).** Contract-infer emits a `managed` `native_enum` for an introspected native type (all inference is managed) instead of throwing.

Do **not** start Phase 2 without a fresh triage and operator go-ahead.

## Dependencies

- **Value-set → codec typing ([TML-2952]).** Merged and in this branch; native typing rides it unchanged (a native column carries a `valueSet` ref like a check-enum column).
- **Pack-entity + variadic-block mechanisms** (`postgresAuthoringEntityTypes`, `variadicParameters` block descriptors, `composeSqlEntityKinds`). Landed — RLS and the SQL `enum` block ship on them.
- **[TML-2960]** (no-emit per-instance column typing). Not a blocker: emit typing works today; no-emit column typing is out of scope until 2960 lands.
- **Phase 2 only:** the RLS SchemaIR differ + extension-contribution seam — the template Phase 2's SchemaIR node, projection, and diff integration follow.

## Tracker

Linear was intentionally skipped for the shipped Phase-1 slices (tracked in-repo). Cross-cutting follow-ups filed: **[TML-2960]** (no-emit per-instance column typing), **[TML-2965]** (TS authoring mirror + the generic `ContractDefinition` pack-entity attachment, shared with RLS), and **[TML-2978]** (parser `refKind` for entity-ref type-constructor arguments, deferred from the generic collapse — consider post-critical-path).
