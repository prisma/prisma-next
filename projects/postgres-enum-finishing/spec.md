# Postgres enum-finishing — project spec

## Status

Proposed. Spawned from PR #499 (TML-2521 — target-extensible IR + entities mechanism + Postgres enum exemplar) review discussion. PR1's M4 milestone delivered enum as the *structural exemplar* for the polymorphic IR mechanism; this project closes the application-facing gaps so enums become *useful in user code*.

## Background

The target-extensible IR project (`projects/target-extensible-ir/`) refactored the IR layer so per-target IR nodes are first-class polymorphic entities, with Postgres enum as the named exemplar that demonstrates the mechanism end-to-end (declaration → JSON envelope → registry-driven hydration → IR-class consumption by verifier / planner). The target-extensible IR project's stated objective for the enum exemplar is *structural*: enum types are first-class IR nodes, codec-hook glue is removed.

That objective is met at the storage representation layer. It is **not** met at any layer where users encounter enums in application code. PR1's M9 (the architectural-honesty close — see § "What lands in PR1") removes the last storage-layer pretence (the `as unknown as StorageTypeInstance` cast that says PostgresEnumType is a codec triple), but it does not address application-facing usability:

- `helpers.entities.enum({ name: 'Role', values: ['admin', 'member', 'guest'] as const })` returns `StorageTypeInstance` statically — the application code has no `'admin' | 'member' | 'guest'` union to work with.
- `@default(Role.member)` (PSL) and the equivalent TS-DSL surface are not implemented; the only `ColumnDefault` variants are `'literal'` and `'function'`.
- `PgEnumCodec` is value-unaware — `Input = string`, `Output = string`. Query-input typing accepts any string, query-output typing returns plain `string` regardless of the column's enum type.
- No `db.enums.<Name>` runtime introspection surface exists.

The result: PR1 ships a structurally correct enum IR node that an application author cannot use idiomatically. This project closes the gap.

## Goal

Make enums a fully-supported first-class authoring + runtime concept across the contract pipeline: declaration carries literal type information end-to-end; default values can reference enum members; column reads/writes are statically typed to the enum's value union; runtime introspection of enum definitions is available.

## Non-goals

- Mongo enum support (Mongo doesn't have a native enum type; enum-equivalent semantics there are application-side validation, out of scope).
- SQLite native enum support (SQLite emulates enums via CHECK constraints; if added later, follows the per-target concrete-class pattern established by Postgres).
- Enum aliases / unions / discriminated enums (Postgres enums are strict literal unions; richer enum semantics belong in a follow-up project if/when needed).
- Enum value mutation operations (`ALTER TYPE … RENAME VALUE`) beyond what the migration planner already supports.

## Use cases this project must support

### UC1 — Declare an enum (PSL + TS DSL)

```prisma
enum Role {
  admin
  member
  guest
}
```

```typescript
({ entities, model, field }) => {
  const Role = entities.enum({ name: 'Role', values: ['admin', 'member', 'guest'] as const });
  // Role is statically typed as PostgresEnumType<'Role', ['admin', 'member', 'guest']>
  // (or equivalent — the literal value union must be statically recoverable)
  return { types: { Role }, models: { ... } };
}
```

**Status today:** PSL works (lowers correctly to `storage.types.Role`). TS DSL works at the runtime level but the static type is erased to `StorageTypeInstance`.

### UC2 — Reference an enum as a column type

```prisma
model User {
  role Role
}
```

```typescript
User: model('User', {
  fields: { role: field.namedType(Role) }
})
```

**Status today:** works (typeRef-based resolution).

### UC3 — Use enum value as a default

```prisma
model User {
  role Role @default(member)
}
```

```typescript
User: model('User', {
  fields: { role: field.namedType(Role).default(Role.member) }
})
```

**Status today:** **not implemented in either surface.** No `'enumMember'` `ColumnDefault` variant; no PSL lowering rule for `@default(EnumName.value)`; no TS-DSL surface to construct an enum-member default.

### UC4 — Query output: typed enum value

```typescript
const result = await db.user.findOne({ where: { id: 1 } });
result.role; // expected: 'admin' | 'member' | 'guest'; today: string
```

**Status today:** **returns `string`.** `PgEnumCodec` is `CodecImpl<typeof PG_ENUM_CODEC_ID, ['equality', 'order'], string, string>` — output type is unconstrained `string`. The codec is shared across all enum types; values are nailed at the contract layer, not the codec layer.

### UC5 — Query input: typed enum value

```typescript
db.user.update({
  where: { id: 1 },
  data: { role: 'pendng' /* typo, accepted at compile time today */ },
});
```

**Status today:** **accepts any string.** Same root cause as UC4.

### UC6 — Runtime introspection of enum definition

```typescript
db.enums.Role;          // expected: definition object exposing values
db.enums.Role.values;   // expected: ['admin', 'member', 'guest']
```

**Status today:** **not exposed.** No `db.enums` surface. Contract consumers can walk `contract.storage.types.Role` themselves but get static erasure due to the cast (closed by PR1's M9; this project rebuilds on the honest types).

## Acceptance criteria

- **AC1:** UC1 — `helpers.entities.enum({ name, values: [...] as const })` returns a value whose static type carries the literal value tuple. `expectTypeOf(Role.values).toEqualTypeOf<readonly ['admin', 'member', 'guest']>()` passes.
- **AC2:** UC3 — `field.namedType(Role).default(Role.member)` (TS DSL) compiles only with members of `Role.values`; PSL `@default(member)` lowers to a `'enumMember'` (or equivalent) `ColumnDefault` variant; the planner emits the correct DDL (`DEFAULT 'member'::Role`).
- **AC3:** UC4 — `result.role` is statically typed as the enum's value union (`'admin' | 'member' | 'guest'`), not `string`. Verified by a type-test.
- **AC4:** UC5 — `data: { role: ... }` accepts only members of the enum's value union at compile time. Verified by a negative type-test (`@ts-expect-error` for invalid literal; positive case passes).
- **AC5:** UC6 — `db.enums.<Name>` exists at the runtime surface; `db.enums.<Name>.values` returns the enum's value tuple at runtime; the static type carries the literal tuple.
- **AC6:** No regression on PR1's M4 / M9 acceptance — the IR class hierarchy stays first-class (no new `as` casts re-introduced); the registry-driven hydration path still serves enum-typed `storage.types` slots; `instanceof PostgresEnumType` dispatch still works in verifier / planner / serializer.
- **AC7:** Cross-target safety — SQLite is unaffected (it has no native enum); other SQL targets that ship native enum support (none today) follow the same per-target-concrete-class pattern.

## Architectural axes (these are what the design has to navigate)

This is a sketch, not a settled design. The first task is to choose between the options on each axis.

### Axis A — `EntityHelperFunction<Descriptor>` literal-tuple propagation

**Problem:** today the factory's declared type erases generics. `EntityHelperFunction<Descriptor>` extracts `(input: infer Input) => infer Output` from the factory signature; the factory signature is `(input: PostgresEnumTypeInput) => PostgresEnumType` with default generics, so the helper signature loses the literal tuple narrowing.

**Options:**

- **A1 — `<const T>` factory signature.** Sharpen the factory to `<const TName extends string, const TValues extends readonly string[]>(input: PostgresEnumTypeInput<TName, TValues>) => PostgresEnumType<TName, TValues>`. Verify whether `EntityHelperFunction`'s conditional inference propagates the generic.
- **A2 — Bypass the registry's typed surface for enum specifically.** Expose `helpers.enum(...)` as a hand-written typed helper that dispatches at runtime through the registry but is typed independently. Loses the mechanism-as-uniform-extension-surface story; gains predictable types.
- **A3 — Hybrid.** Try A1 first; fall back to A2 if A1 doesn't propagate.

**Decision dependency:** UC1 is gated by this axis. UC2 / UC3 / UC4 / UC5 are downstream — they propagate whatever Axis A produces.

### Axis B — `ColumnDefault` enum-member variant

**Problem:** `ColumnDefault` today is `'literal' | 'function'`. Neither expresses "this default is the `member` value of enum `Role`."

**Options:**

- **B1 — Add `'enumMember'` variant.** `{ kind: 'enumMember', enumName: string, value: string }`. PSL lowering recognises `@default(EnumName.value)`; the planner emits `DEFAULT 'value'::EnumName`. Cleanest separation; new variant means new validators, new fixture-cascade work.
- **B2 — Encode as `'literal'` with cross-validation.** Default is a string literal whose value the planner validates against the column's resolved enum type. Reuses existing validators; loses static narrowing at the type system (the literal could be any string until the planner validates).
- **B3 — Encode at the column-builder layer, not the contract.** TS DSL's `field.namedType(Role).default(Role.member)` resolves to a `'literal'` at contract emission, but the builder enforces type-safety statically. PSL still needs a lowering rule for the same shape.

**Decision dependency:** UC3 is the load-bearing UC; B1 is the principled choice but the cascade work is non-trivial.

### Axis C — Codec value-awareness

**Problem:** `PgEnumCodec` is one codec serving all enum types. It can't have a parameterised input/output type because it doesn't know which enum is being used.

**Options:**

- **C1 — Codec parameterisation.** `PgEnumCodec<TValues>` takes the values tuple as a generic; `Input = TValues[number]`, `Output = TValues[number]`. The column-typing layer dispatches to the right parameterised codec instance per column. Cleanest; potentially expensive on the codec lookup path.
- **C2 — Column-typing layer narrowing above the codec.** Codec stays `string ↔ string`; the lane-time column-typing layer narrows the static type based on the column's resolved enum. Cheaper at runtime; more work in the lane-time type-narrowing machinery.
- **C3 — Hybrid.** Codec stays generic; runtime + lane-time narrowing happens at the column reference.

**Decision dependency:** UC4 + UC5 are gated by this axis.

### Axis D — `db.enums` runtime surface

**Problem:** No surface exists today.

**Options:**

- **D1 — Mirror `db.tables` / `db.collections` shape.** `db.enums.<Name>` returns a definition object; `.values` is the literal tuple; methods on it (e.g. `.includes(value)`, `.assert(value)`) cover common enum-validation patterns.
- **D2 — Expose only via `contract.storage.types`.** No new surface; users introspect through the contract directly. Lower-cost; less ergonomic.
- **D3 — Both.** `db.enums.<Name>` is the ergonomic surface; the underlying definition is available via `contract.storage.types` for power users.

**Decision dependency:** UC6 is the only direct consumer; D2 is the cheapest, D1/D3 trade ergonomics for surface size.

### Axis E — Sequencing within the project

**Problem:** Axis A blocks B/C/D — without literal propagation at the source, the rest can't propagate types they don't see.

**Sequence:**

1. **Phase 1 — Axis A.** Land literal-tuple propagation. Deliverable: UC1 type-test passes.
2. **Phase 2 — Axes B + D in parallel.** Independent of each other; both depend on Axis A's literal types. Deliverables: UC3, UC6.
3. **Phase 3 — Axis C.** Codec value-awareness. Largest lift. Deliverables: UC4, UC5.

## Open questions

- Are user-facing query types (UC4 / UC5) genuinely blocked on codec-side work, or can they be solved at a higher layer (lane time, query-output type derivation) without touching the codec?
- Does PSL `@default(EnumName.value)` need new grammar, or does the existing PSL parser already accept this expression and only the lowering rule is missing?
- Is the `db.enums.<Name>` surface scoped to this project, or does it belong in a broader "ORM surface for IR-modelled entities" project (which would also surface namespaces, policies, roles, views as `db.<plural>.<Name>`)?

## Success criteria

A user can declare a Postgres enum once (PSL or TS DSL), and from that single declaration:

- the contract carries the literal value union end-to-end;
- the column accepts only valid values at compile time on writes;
- query output returns the literal value union, not `string`;
- `@default(EnumName.value)` is expressible and validated;
- the runtime exposes the enum definition for introspection.

A type-test fails if any of the propagation steps regress.
