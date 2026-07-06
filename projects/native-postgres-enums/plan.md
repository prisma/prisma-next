# Native Postgres enums — plan

**Spec:** [`spec.md`](spec.md)
**Linear project:** _(to create — see § Tracker)_

## At a glance

Two phases. **Phase 1** makes a native Postgres enum representable in the contract and
surfaced to the app as a typed value union, graded `external` so Prisma Next emits no DDL
— this is the primary deliverable and what unblocks Supabase. **Phase 2** lets Prisma Next
create/delete native enums and migrate the cheap ops (add value, rename value) in place,
refusing the expensive ones (remove, reorder). Each slice is a vertical: it goes all the
way to a typed read or a live-database migration, with an end-to-end test — never a layer
in isolation.

Phase 1 needs the contract representation + the TML-2886 typing path. Phase 2 adds the
SchemaIR node, the Contract→SchemaIR projection, the generic-differ integration, and the
four migration ops — all reusing the RLS top-level-object template
(`PostgresRlsPolicy`/`PostgresRole` → `PostgresEnumType`).

## Phase 1 — represent + surface (external-graded, no DDL)

### Slice P1.S1 — `native-enum-representation-and-typing`
- **Outcome:** A native Postgres enum is a first-class storage entity and a column using it
  reads as the value union. The storage `type` entity (`kind: postgres-enum`, ordered
  `values`, optional `control`) round-trips through serializer + validator (composed into
  the Postgres pack's `composeSqlEntityKinds([…, typeEntityKind])`). A storage column
  references the type and reads/writes as the value union — query builder + ORM, emitted
  contract **and** no-emit path — via the TML-2886 `StorageColumnTypes` lookup. `db.enums`
  parity holds (it reads the unchanged domain enum).
- **Covers:** R1, R2, R3, R4. Components #1, #5, #6.
- **Builds on:** `composeSqlEntityKinds` + the RLS top-level-object pattern (landed);
  TML-2886 `StorageColumnTypes` (landed).
- **Proven by:** an authored fixture contract carrying a native `type` entity + a column
  that references it; type-tests asserting the value union (QB, ORM, direct
  `StorageColumnTypes` index) and a negative test for out-of-set input; round-trip +
  `fixtures:check`.
- **Resolves:** Open decisions 1 (column→type join shape) and 2 (slot name) — these are
  design calls this slice must settle in its spec before building.

### Slice P1.S2 — `external-native-enums-supabase`
- **Outcome:** Native enums graded `external` produce no DDL and no drift reports; the
  Supabase extension contributes its built-in native enums into the contract, and they
  surface in the supabase example as typed unions. Introspection captures **ordered**
  enum values (`pg_enum.enumsortorder`), not just names.
- **Covers:** R5. Component #1 (introspection side) + the grade plumbing.
- **Builds on:** P1.S1 (representation); the RLS extension-contribution seam
  (extension-migration-participation) — **dependency to confirm landed** (see § Tracker).
- **Proven by:** the supabase example carrying a Supabase-defined native enum, end-to-end:
  represented, typed read, and `db verify` / migration emits nothing for it.
- **Resolves:** Open decision 4 (extension-declared vs. introspected source).

### Slice P1.S3 — `adopt-native-enums`
- **Outcome:** Contract-infer emits the native `type` representation for an introspected
  native enum instead of throwing (today's hard refusal at
  `sql-schema-ir-to-psl-ast.ts`). A user porting an existing Postgres/Supabase project gets
  their native enums into the contract.
- **Covers:** R6. Component #1 (adoption path).
- **Builds on:** P1.S1 (representation) + P1.S2 (ordered-value introspection).
- **Proven by:** an introspect→contract test over a database with a native enum; the
  inverted path emits the `type` entity + typed columns.
- **Resolves:** Open decision 3 (adopted-enum grade — `external` for the first cut).
- **Parallel with P1.S2** once P1.S1 lands, if introspection is split cleanly; otherwise
  sequence after P1.S2.

## Phase 2 — create / delete / cheap ops (PN-managed)

### Slice P2.S1 — `native-enum-schema-ir-and-diff`
- **Outcome:** A `PostgresEnumType` `DiffableNode` (`identity()` on the type name,
  `isEqualTo()` over ordered values) exists; the contract's native `type` entities project
  into `PostgresSchemaIR` (new `enumTypes` field, mirroring `rlsPolicies`/`roles`); the
  generic differ reports missing / extra / value-mismatch; `external`/`observed` grades
  suppress drift (phase-1 enums stay untouched).
- **Covers:** R10. Components #2, #3 (read/verify side).
- **Builds on:** P1.S1; the RLS generic differ (`diffSchemas`/`diffNodes`) — landed/landing.
- **Proven by:** verify against a live database — matching enum (no issues), value drift
  (mismatch reported), external enum (suppressed).

### Slice P2.S2 — `create-delete-native-enums`
- **Outcome:** A domain enum can be authored with the native strategy (PSL/TS attribute
  selecting native realization; default stays check). Prisma Next emits `CREATE TYPE … AS
  ENUM` (declared order) and `DROP TYPE`, ordered relative to the columns that depend on
  the type (the planner's existing `'type'` → dependency bucket).
- **Covers:** R7. Component #4 (create/delete) + authoring opt-in for #5.
- **Builds on:** P2.S1 (SchemaIR + diff).
- **Proven by:** live-database end-to-end — author native enum → `CREATE TYPE` + table uses
  it → typed read → drop → `DROP TYPE`, ordered correctly.

### Slice P2.S3 — `cheap-enum-ops-and-refuse-expensive`
- **Outcome:** Adding a value and renaming a value migrate in place (`ALTER TYPE … ADD
  VALUE` / `RENAME VALUE`) with no table rewrite; a diff that would remove or reorder values
  is refused with a diagnostic naming the manual procedure — never lowered to an op. The
  `ADD VALUE` non-transactional caveat is surfaced to the runner.
- **Covers:** R8, R9. Component #4 (alter ops + refusal).
- **Builds on:** P2.S1 + P2.S2.
- **Proven by:** live-database end-to-end for add + rename; a negative test that
  remove/reorder produces the diagnostic and no op.

## Sequencing

- **P1.S1 first** — every other slice reads the contract representation it lands.
- **P1.S2 / P1.S3 parallelize** after P1.S1 (both build on representation; S3 wants S2's
  ordered-value introspection — sequence if that split isn't clean).
- **Phase 2 after Phase 1**, sequential: schema-IR + diff → create/delete → cheap ops +
  refusal. Mutation builds on the verify path; cheap ops build on create/delete.
- **Phase boundary is a real stop:** Phase 1 is independently shippable (it's the promised
  first deliverable). Phase 2 begins only when Phase 1 has landed and the user-facing
  message's first promise is met.

## Dependencies (external)

- **RLS differ + extension-contribution seam.** The top-level-object template
  (`composeSqlEntityKinds`, `DiffableNode`, the generic differ) and the
  extension-contribution mechanism. The composition + differ are landed (PR #771) / landing
  (PR #868). The extension-contribution seam (extension-migration-participation) gates
  **P1.S2** specifically — confirm its state before scheduling that slice.
- **TML-2886 `StorageColumnTypes`.** Landed (this just-merged work). The typing path P1.S1
  rides.

## Tracker

Not yet created. Before opening implementation PRs: create the Linear project "Native
Postgres enums" and one issue per slice (no sub-issues — use the project + relations +
labels per repo convention). Hold until the operator approves the spec + this plan.

## Cruft to retire or justify (tracked, not assumed)

The pre-migration hacky-enum plumbing overlaps this work and must be either reused with
justification or deleted:
- the uncomposed `PostgresEnumTypeSchema` validator,
- `StorageColumn.typeRef` + the `storage.types` map resolved in `planner-type-resolution.ts`
  (Postgres) and `planner-ddl-builders.ts` (SQLite),
- the names-only `nativeEnumTypeNames` introspection field.

P1.S1 decides reuse-vs-replace for the column→type join (Open decision 1); whatever it
doesn't adopt, a later slice deletes so the final state has one representation.
