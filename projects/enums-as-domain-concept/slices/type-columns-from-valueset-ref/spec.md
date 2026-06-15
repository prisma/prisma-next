# Slice: type-columns-from-valueset-ref

Parent project: `projects/enums-as-domain-concept/`. Linear:
[TML-2886](https://linear.app/prisma-company/issue/TML-2886).

Closes the mechanism divergence from spec §5 (settled in the PR #805 review,
2026-06-11): each plane must type its own enum columns from its own `valueSet`
ref — **no cross-plane reach, no baked map**.

## The divergence

Spec §5 is explicit: *"the ORM types from the domain field's `valueSet`, the
query builder types from the column's `valueSet`, both directly, no cross-plane
reach and no parameterized codec."* The current implementation does neither half
faithfully:

- The emitter **bakes** domain-enum literal unions into the `FieldOutputTypes` /
  `FieldInputTypes` TypeMap at `contract.d.ts` generation time, via the
  `EnumValuesResolver` closure in `generate-contract-dts.ts` and the enum fork in
  `domain-type-generation.ts`.
- The query-builder lane (`ExtractOutputType` → `FieldOutputOverride` in
  `query-builder/src/selection.ts`) types a column by reaching column → model
  field → that baked map — a cross-plane reach via the model mapping, not the
  column's own ref.
- The ORM lane (`ComputeColumnJsType` in `relational-core/src/types.ts`) reads
  the same baked `ExtractFieldOutputTypes[Model][Field]` map — not the domain
  field's ref.
- The emitted `contract.d.ts` types **no `valueSet` ref at all**: neither the
  storage column's ref nor the domain field's ref appear in the emitted types.
  Only the storage value-set entity's `values` tuple is emitted today (under
  `storage.namespaces[ns].entries.valueSet[Name].values`, already literal-typed).
  The migration system reads the refs from `contract.json`; the type system
  cannot see them.

## The work

Move to reference-following — each plane self-contained:

1. **Emit both `valueSet` refs into `contract.d.ts`.** The storage column's
   `valueSet` ref (in `generateTableLiteralType`) and the domain field's
   `valueSet` ref (in `generateModelFieldEntry`). Both refs already exist in
   `contract.json` (`StorageColumn.valueSet`, `ContractField.valueSet`); this is
   a **`.d.ts`-only** rendering addition. The storage value-set `values` tuple is
   already emitted (TML-2885's storage analogue, landed) — unchanged.
2. **Query-builder lane** resolves a column's own storage `valueSet` ref against
   `storage.namespaces[ref.namespaceId].entries.valueSet[ref.entityName].values`
   — type-level, generic, intra-plane. Replaces the `FieldOutputOverride`
   cross-plane walk in `selection.ts`.
3. **ORM/field side** symmetrically resolves the domain field's `valueSet` ref
   against the emitted domain `enum` block
   (`domain.namespaces[ref.namespaceId].enum[ref.entityName].members[*].value`).
   Replaces the baked-map index in `ComputeColumnJsType`.
4. **Retire the baked enum overrides.** Remove the enum fork in
   `resolveFieldType` / `generateBothFieldTypesMaps`, the `EnumValuesResolver`
   type + parameter, and the `resolveEnumValues` closure in
   `generate-contract-dts.ts`. The maps **stay** — they still carry
   parameterized-codec overrides (`Vector<N>`, `Char<N>`), valueObject aliases,
   union-kind fields, and plain codec outputs (consumed by retail-store as plain
   field maps). Only the enum-narrowing path is removed; an enum column's map
   entry falls back to its codec output, with the union now supplied by the
   lane-level ref resolution.

## What stays the same (the anchor)

Observable types do not change — `'low' | 'high' | 'urgent'` stays
`'low' | 'high' | 'urgent'`; the **source** moves to where §5 always said it was.
The existing through-emit demo type tests
(`examples/prisma-next-demo/test/demo-dx.types.test.ts`) are the behavioral
anchor and must stay **green and unmodified**. `contract.json`, `storageHash`,
and `profileHash` are byte-identical (a `.d.ts`-only change — assert it; a hash
move is a halt-and-investigate red flag).

## Chosen design

### Emission (change sites)

- `generateTableLiteralType` (`sql-family emitter/src/index.ts`) renders a
  `readonly valueSet: { readonly plane: 'storage'; readonly namespaceId: ...;
  readonly entityKind: 'valueSet'; readonly entityName: ... }` member on a
  storage column literal when `col.valueSet` is present. Absent ⇒ no member.
- `generateModelFieldEntry` (`emitter/src/domain-type-generation.ts`) renders the
  domain field's `valueSet` ref literal (`plane: 'domain'`, `entityKind: 'enum'`)
  when `field.valueSet` is present. Absent ⇒ no member.
- Render via the existing `serializeValue` / `serializeObjectKey` helpers; the
  ref is a flat record of string literals (plus optional `spaceId`). Reuse, don't
  duplicate.

### Query-builder resolution (selection.ts)

`ExtractOutputType` checks the column literal's `valueSet` member first: if
present, resolve
`UnboundTables<TContract>` → no — resolve against the emitted storage value-set:
index `TContract['storage']['namespaces'][ref['namespaceId']]['entries']
['valueSet'][ref['entityName']]['values'][number]` for the union, apply column
nullability. If absent, fall back to the codec output (unchanged). Delete
`FieldOutputOverride` and its `ExtractFieldOutputTypes` cross-walk.

### ORM resolution (ComputeColumnJsType)

`ComputeColumnJsType` already walks storage table/column → domain model/field to
index the baked map. Replace the final index: follow the **domain field's**
`valueSet` ref to the domain enum block and take
`members[number]['value']` as the union; apply nullability. Falls back to the
codec output when no ref. Also check the `sql-builder` table-proxy
`resolvedColumnOutputTypes` / `insert` / `update` input paths consume the same
resolution.

### Retirement

Remove only the enum fork (`field.valueSet?.entityKind === 'enum'` branch),
`EnumValuesResolver`, and `resolveEnumValues`. Keep every other branch of
`generateBothFieldTypesMaps`.

## Scope

**In:**
- `.d.ts` emission of both `valueSet` refs (storage column + domain field).
- Query-builder lane ref resolution (`selection.ts`).
- ORM lane ref resolution (`ComputeColumnJsType` + sql-builder table-proxy input/
  output paths as needed).
- Retiring the enum override fork + `EnumValuesResolver` + `resolveEnumValues`.
- New per-hop type-tests proving the union now comes from ref-following (a test
  that goes red if a ref is dropped or a hop widens — non-vacuity stated).
- Fixture regeneration (`.d.ts` only).
- Updating mechanism-specific tests that assert the **old** location of the union
  (the union no longer appears in the emitted `FieldOutputTypes` text — see Edge
  cases).

**Out:**
- Any change to `contract.json`, the migration/verification path, or DDL (already
  reads refs from `contract.json` correctly — explicitly out per the ticket).
- Domain enum block emission (TML-2885, landed) and storage value-set `values`
  emission (landed) — both reused unchanged.
- The non-enum responsibilities of `FieldOutputTypes`/`FieldInputTypes`
  (parameterized codecs, valueObjects, unions) — untouched.
- Mongo (TML-2884).

## Contract-impact

`contract.d.ts` only — enum columns gain a `valueSet` ref on the storage column
literal; enum domain fields gain a `valueSet` ref on the field literal.
`contract.json` byte-identical; `storageHash`/`profileHash` unchanged (verify — a
hash move is a halt). `fixtures:check`: regenerates `.d.ts` across the demo, the
migration `end-contract.d.ts` fixtures, and the package test fixtures
(`sql-builder`, `sql-orm-client`, e2e, integration). No `.json` fixture moves.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `emitter.integration.test.ts` asserts the union text inside the emitted `FieldOutputTypes` block | **Update the assertion** | After retirement the union no longer appears there; assert it appears via the lane resolution instead (or that the field falls back to codec output in the map). This is a legitimate mechanism-moved test change, not an anchor regression. |
| Non-string member values (`Low = 1`) | Number literals resolve the same way | Cover one int-codec enum in the new type-tests. |
| `__unbound__` namespace | Ref carries `__unbound__` as `namespaceId`; resolution indexes it like any namespace | Cover in the emitter/lane unit tests. |
| Column with `valueSet` but no domain field mapping (raw value-set, no enum) | Query-builder still types it from the storage value-set; ORM has no field, so no ORM type | The query-builder path must not depend on a model field existing. |
| Parameterized-codec column (`Vector<N>`) | Untouched — still resolved through the retained map path | Regression-guard with the existing `computeColumn-js-type` tests. |

## Slice-specific done conditions

- [ ] Both `valueSet` refs render in the emitted `contract.d.ts` (storage column
  + domain field); emitter unit tests assert the rendered shape, including
  `__unbound__` and an int-codec enum.
- [ ] Query-builder lane types an enum column from the storage value-set ref;
  ORM lane types an enum field from the domain enum block ref — per-hop type
  tests, each non-vacuous (state how non-vacuity was verified: drop the ref ⇒
  test goes red).
- [ ] The enum fork, `EnumValuesResolver`, and `resolveEnumValues` are **gone**;
  `generateBothFieldTypesMaps` retains its parameterized-codec / valueObject /
  union / codec-output branches; retail-store still type-checks.
- [ ] `examples/prisma-next-demo/test/demo-dx.types.test.ts` stays green
  **unmodified** (the behavioral anchor).
- [ ] `contract.json` byte-identical; `storageHash`/`profileHash` unchanged.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm fixtures:check`, the no-bare-cast
  ratchet, and the affected package test suites pass.

## Open questions

None blocking. Design follows spec §5 verbatim; the emission pattern mirrors the
already-landed TML-2885 storage value-set / domain enum block work.

## References

- Parent spec §2 (ref shape), §5 (the divergence), §6 (literal propagation);
  `plan.md` "Current status & next" (TML-2886 entry).
- Sibling: `slices/emit-typed-domain-enums/spec.md` (TML-2885 — the correct half;
  the emission pattern to mirror).
- Surfaces (grounded by discovery):
  - `emitter/src/generate-contract-dts.ts:31-41` (`generateEnumBlockType`),
    `:177-189` (`resolveEnumValues` + `generateBothFieldTypesMaps` call — to
    retire the enum closure).
  - `emitter/src/domain-type-generation.ts:299-303` (`EnumValuesResolver`),
    `:333-343` (enum fork in `resolveFieldType`), `:402-449`
    (`generateBothFieldTypesMaps` — keep the rest), `generateModelFieldEntry`
    (add domain field ref).
  - `sql-family emitter/src/index.ts:413-482` (`generateTableLiteralType` — add
    column ref), `:377-391` (`generateNamespaceValueSetType` — values already
    emitted, unchanged).
  - `query-builder/src/selection.ts:30-71` (`FieldOutputOverride` /
    `ExtractOutputType` — rewrite to storage-ref resolution).
  - `relational-core/src/types.ts:129-152` (`ComputeColumnJsType` — rewrite to
    domain-ref resolution); `sql-builder/src/types/table-proxy.ts:123,146,157`.
  - Refs/shapes: `contract/src/value-set-ref.ts` (`ValueSetRef`),
    `sql-contract storage-column.ts:47` (`StorageColumn.valueSet`),
    `storage-value-set.ts` (`StorageValueSet.values`).
  - Anchor tests: `examples/prisma-next-demo/test/demo-dx.types.test.ts:40-67`;
    mechanism tests to update: `emitter.integration.test.ts:236`,
    `domain-type-generation.test.ts:1258`.
</content>
