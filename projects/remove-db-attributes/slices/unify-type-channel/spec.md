# Slice: unify-type-channel

Parent project: `projects/remove-db-attributes/`. Outcome contributed: the unified type-contribution channel exists — the substrate every later slice registers native types into.

## At a glance

Retires the `scalarTypeDescriptors` map channel (`ComponentMetadata.scalarTypeDescriptors` → `assembleScalarTypeDescriptors` → `ContractSourceContext.scalarTypeDescriptors`). Postgres, sqlite, and mongo contribute their base scalars as zero-arg `AuthoringTypeConstructorDescriptor` entries in `AuthoringContributions.type`; every consumer of the old map (SQL provider, mongo provider, symbol table, LSP, codec-id validation) re-derives from the unified namespace. No authoring-syntax or semantic change — contract emission is byte-identical on all three targets.

## Chosen design

**Doctrine: a scalar type is a zero-arg type constructor.**

Contribution side — each adapter replaces its map with authoring contributions (ownership stays with the component that owned the map entry):

```ts
// Before (packages/3-targets/6-adapters/postgres/.../control-mutation-defaults.ts)
const postgresScalarTypeDescriptors = new Map([['String', 'pg/text@1'], /* … */]);

// After (same component, authoring contribution)
const postgresScalarAuthoringTypes = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'pg/bool@1', nativeType: 'bool' } },
  // … Int, BigInt, Float, Decimal, DateTime, Json, Bytes
} as const satisfies AuthoringTypeNamespace;
```

Contributed constructors carry **explicit** `nativeType` (the values the old `codecLookup.targetTypesFor(codecId)[0]` derivation produced — parity tests pin them). `AuthoringStorageTypeTemplate.nativeType` stays optional in the framework shape; this slice does not add a codecLookup-derivation fallback for constructors — explicit beats derived.

Resolution side — bare `T` ≡ `T()`, implemented as derived views over the assembled namespace (resolution call-shapes stay put, which is what makes byte-identical parity cheap to hold):

- **SQL provider**: `buildColumnDescriptorMap` walks the assembled `AuthoringContributions.type` top-level zero-arg constructors (instead of `context.scalarTypeDescriptors`) to produce the same `ReadonlyMap<string, ColumnDescriptor>` the interpreter already consumes. Parameterized calls (`Vector(1536)`) keep flowing through `resolveFieldTypeDescriptor`'s existing `typeConstructor` path.
- **Mongo provider**: derives its `name → codecId` map from the same namespace walk; the mongo interpreter's internals stay untouched.
- **Symbol table / LSP**: `controlStack.scalarTypes` (and the providers' `scalarTypes` inputs) become the top-level zero-arg-constructor names of the assembled namespace.
- **Codec-id validation**: `validateScalarTypeCodecIds` re-points at the namespace walk (every zero-arg constructor's `output.codecId` must be a registered codec).

Retired at slice end (hard cut, per F1 discipline): `ComponentMetadata.scalarTypeDescriptors`, `assembleScalarTypeDescriptors`, `ContractSourceContext.scalarTypeDescriptors`, `buildColumnDescriptorMap`'s codecLookup derivation, and every adapter's scalar map.

## Coherence rationale

One concept applied everywhere it lives: "the scalar map is a compressed zero-arg type constructor — inline the compression." The reviewer verifies one substrate change plus its mechanical fan-out across three adapters and the derived views; a single grep (`scalarTypeDescriptors`) proves the cut is complete.

## Scope

**In:** `packages/1-framework/1-core/framework-components` (control stack, framework-authoring shapes if needed), `packages/1-framework/1-core/config` (`ContractSourceContext`), `packages/2-sql/2-authoring/contract-psl` (provider derivation), `packages/2-mongo-family/2-authoring/contract-psl` (provider derivation), adapters `3-targets/6-adapters/postgres`, `3-targets/6-adapters/sqlite`, `3-mongo-target/2-mongo-adapter`, LSP wiring (`config-resolution.ts`, `controlStack.scalarTypes` source), tests of all of the above.

**Out:** postgres native types (`Uuid`, `VarChar`, …) — slice 2. `Json`/`Jsonb` re-binding — slice 2. Any `@db.*` behavior — slices 3–4. psl-infer printing — slice 3. New authoring syntax of any kind.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Top-level constructor name collides with a namespaced one (`String` vs `sql.String`) | Not a collision | `mergeAuthoringNamespaces` keys by full path; `sql.String` lives under the `sql` namespace. Collision check must still reject two *top-level* `String` contributions. |
| `checkUncomposedNamespace` firing on bare names | Non-issue | It only inspects dotted paths; top-level names carry no namespace. Verify with a test, don't re-implement. |
| Mongo's `ObjectId` | Migrates like any scalar | It's an ordinary entry in mongo's map; no special-casing. |
| LSP default config (`config-resolution.ts` `scalarTypes: []`) | Preserve empty-default behavior | The no-project fallback keeps an empty list. |
| Transitional folding left behind | Hard-cut gate | Any assembly-time map→namespace folding introduced mid-slice must be deleted before PR-open (failure-mode F1: dual-shape support relocated under a new name). |

## Slice-specific done conditions

- [ ] `rg 'scalarTypeDescriptors' packages --type ts -g '!*test*'` returns zero hits.
- [ ] Contract-emission parity: postgres, sqlite, and mongo fixture/e2e contracts byte-identical to pre-slice (`pnpm fixtures:check` clean with no regenerated drift; targeted emission tests for one schema per target).
- [ ] LSP completions + semantic tokens for scalar type names pass against the derived list (existing LSP tests stay green without weakening).
- [ ] `pnpm lint:deps` clean (channel moves cross package boundaries).

## Open Questions

1. Should `validateScalarTypeCodecIds` survive under a new namespace-walking name, or fold into existing namespace assembly validation? Working position: keep a named validation walk (renamed appropriately) — the codec-existence check is load-bearing at stack-composition time; where it lives is dispatch-time discovery.

## References

- Parent project: `projects/remove-db-attributes/spec.md`
- Linear issue: [TML-2985](https://linear.app/prisma-company/issue/TML-2985)
- Key surfaces: `control-stack.ts` (`assembleScalarTypeDescriptors`, `assembleAuthoringContributions`, `validateScalarTypeCodecIds`), `contract-source-types.ts`, SQL `provider.ts` (`buildColumnDescriptorMap`), mongo `provider.ts`/`interpreter.ts`, `control-mutation-defaults.ts` (pg + sqlite), mongo `exports/control.ts`, `framework-authoring.ts` (`AuthoringTypeConstructorDescriptor`, `AuthoringTypeNamespace`)
- Calibration: failure modes F1, F3, F14, F16, F18; grep-library § Cross-cutting anti-patterns
