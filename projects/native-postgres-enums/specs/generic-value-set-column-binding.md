# Design: collapse the entity-ref-resolution machinery into a generic value-set column binding

Follow-up refactor for the native-Postgres-enum work (PR #906), driven by review. The MVP shipped, but the authoring path grew bespoke machinery — a framework `entityRefTypeConstructor` kind, an opaque `resolve(): object` hook, an `SqlEntityRefResolution` payload re-narrowed by a predicate, and a codec `enforcesValueSet` marker. Review flagged all of it. This design removes what isn't earning its keep and keeps what is.

## Grounding

Authoring is unchanged:

```prisma
namespace auth {
  native_enum AalLevel { aal1 = "aal1"  aal2 = "aal2"  aal3 = "aal3"  @@map("aal_level") }
  model AuthSession { aal pg.enum(AalLevel)? }
}
```

`pg.enum(AalLevel)` must produce one storage column:

```
{ codecId: 'pg/enum@1', typeParams: { typeName: 'auth.aal_level' }, valueSet: <ref to AalLevel> }
```

Everything the column needs is in those three fields. The native type (`auth.aal_level`) is derived by the codec from `typeParams`; the member union types through the value-set. There is no fourth thing.

## Decision

Three changes. Each maps to a review comment.

### 1. The resolver returns a concrete SQL column-binding, not an opaque payload

`pg.enum(Ref)` is a column type whose parameter is a *resolved reference to a named entity* — that construct is real and stays. What goes is the framework-opaque round-trip. The only registrant is Postgres and the only caller is `@prisma-next/sql-contract-psl`; **producer and consumer are both SQL**, so the family-neutral `object` return buys nothing.

- The resolver returns a concrete, SQL-typed column binding `{ codecId, typeParams, valueSetEntityName }` — the same three generic fields any parameterized-codec-plus-value-set column carries. `nativeType` drops out of the payload (the codec owns it — see §3).
- Delete `SqlEntityRefResolution` and `isSqlEntityRefResolution`: with a typed return there is nothing to re-narrow.
- `isAuthoringEntityRefTypeConstructorDescriptor` stops taking `unknown` + `blindCast`; it narrows from the authoring-descriptor base union like its siblings should.

Addresses: *"What is an entity-ref-resolution"* (the type now reads as what it is — a column binding), *"Why `object`?"*, and *"Don't create type predicates which take unknown."* Sweep the sibling predicates (`isAuthoringTypeConstructorDescriptor`, `isAuthoringFieldPresetDescriptor`) in the same pass — same class.

### 2. The interpreter emits an explicit CHECK into the ContractIR — no codec marker

A text-backed enum (a value set enforced by a `CHECK`) and a native enum (enforced by the Postgres type) differ only in *whether a CHECK constraint exists*. Today that is decided downstream: `build-contract` auto-generates a CHECK for every value-set column and the codec's `enforcesValueSet` marker suppresses it. Invert that.

- Delete `EnforcesValueSetCodecDescriptor`, `providesEnforcesValueSet`, `codecEnforcesValueSet`, and the `enforcesValueSet` flag on `PgEnumDescriptor`.
- The value-set-column authoring path **produces an explicit CHECK constraint in the ContractIR when the value set is text-backed, and produces none for a native enum.** Presence/absence in the IR is the whole record; nothing downstream consults a marker.

This also puts the fact where it belongs: with `pg/text` the codec has no idea whether storage enforces the set, so "enforced" was never the codec's fact to hold.

### 3. Keep the enum codec and `nativeTypeFor` — researched, not collapsible

The parameterized `pg/enum` codec owns its per-instance native type (`auth.aal_level` from `typeParams`). That is the codec doing its job, and it is the only thing in scope when the renderer emits `$N::auth.aal_level`. Confirmed against the code:

- The renderer holds a `SqlCodecLookup`, whose `get(id)` is id-keyed (one instance per id, not per-`typeParams`); getting a per-`typeParams` instance needs `CodecRegistry.forCodecRef`, which the render path isn't given.
- Materializing one needs a `SqlCodecInstanceContext.usedAt` the render site doesn't have; materializing a stateful codec there would mis-instantiate it.
- `nativeType` is params-level and SQL-specific, so it belongs as a params-function on the SQL-side lookup — which is what `nativeTypeFor` is.

So the codec, `nativeTypeFor`, `SqlCodecLookup`, and `attachNativeTypeFor` all stay. Optional polish (not required): fold the static `meta.nativeType` and per-instance `nativeTypeFor` into one params-aware nativeType channel so the renderer stops doing `instance ?? static`.

## Deletions enabled

- `SqlEntityRefResolution`, `isSqlEntityRefResolution` (and their export).
- `EnforcesValueSetCodecDescriptor`, `providesEnforcesValueSet`, `codecEnforcesValueSet`, `enforcesValueSet`.
- The `blindCast` in `isAuthoringEntityRefTypeConstructorDescriptor`.

## Kept

- The `entityRefTypeConstructor` construct (real: a column type parameterized by an entity ref).
- `pg/enum@1` codec + `nativeTypeFor` + `SqlCodecLookup` + `attachNativeTypeFor`.
- The value-set derivation from `native_enum`.

## Risks to validate first

- The resolver's typed return has to satisfy the framework registration channel (`AuthoringContributions`) without re-introducing opacity — confirm the SQL-typed shape threads through `control-stack` without a framework-level cast.
- Moving CHECK production into the interpreter must keep the emitted contract byte-identical for existing text-backed enums (`fixtures:check`), and continue to emit *no* CHECK for native enums.
