# type-columns-from-valueset-ref — Slice plan

**Spec:** `./spec.md` · **Linear:**
[TML-2886](https://linear.app/prisma-company/issue/TML-2886) · **Branch:**
`tml-2886-slice-type-columns-from-their-own-valueset-ref-storage-plane`

One PR. Test-first throughout; the per-hop type-tests are the decisive evidence
and must go red if any propagation hop regresses. The demo through-emit type
tests (`demo-dx.types.test.ts`) are the unmodified behavioral anchor.

## Dispatch units (in order)

### U1 — Emit both `valueSet` refs into `contract.d.ts`

Add the storage column's `valueSet` ref to `generateTableLiteralType`
(`sql-family emitter/src/index.ts`) and the domain field's `valueSet` ref to
`generateModelFieldEntry` (`emitter/src/domain-type-generation.ts`). Render via
`serializeValue` / `serializeObjectKey`. Storage value-set `values` already
emitted — unchanged.

- **Test-first:** emitter unit tests asserting the rendered ref shape for a
  storage column and a domain field, plus `__unbound__` and an int-codec enum.
- **Verify:** `contract.json` byte-identical; `storageHash`/`profileHash`
  unchanged. Regenerate `.d.ts` fixtures (`pnpm fixtures:emit`); `fixtures:check`
  shows only `.d.ts` diffs.
- **Self-contained:** no consumer reads the new refs yet, so all suites stay
  green. Independently verifiable.

### U2 — Both lanes follow their own-plane ref

Depends on U1.

- **Query-builder** (`query-builder/src/selection.ts`): rewrite `ExtractOutputType`
  to resolve the column literal's `valueSet` ref against
  `storage…entries.valueSet[entityName].values[number]` (nullability applied);
  fall back to codec output when absent. Delete `FieldOutputOverride` and its
  `ExtractFieldOutputTypes` cross-walk.
- **ORM** (`relational-core/src/types.ts` `ComputeColumnJsType`; check
  `sql-builder/src/types/table-proxy.ts` output + insert/update input): follow the
  **domain field's** `valueSet` ref to the domain enum block
  (`members[number]['value']`); fall back to codec output when absent.
- **Test-first:** per-hop type-tests in each lane proving the union now comes from
  ref-following; each non-vacuous (drop the ref ⇒ red). Cover the value-set-only
  column (no domain field) for the query-builder path.
- **Verify:** demo anchor tests green unmodified. The baked enum override is now
  unused by both lanes (still present — removed in U3).

### U3 — Retire the baked enum override

Depends on U2.

- Remove the enum fork in `resolveFieldType`
  (`field.valueSet?.entityKind === 'enum'`), the `EnumValuesResolver` type +
  parameter (`domain-type-generation.ts`), and the `resolveEnumValues` closure
  (`generate-contract-dts.ts`). Keep every other `generateBothFieldTypesMaps`
  branch (parameterized codecs, valueObjects, unions, codec output).
- **Update mechanism tests** that assert the union at its old location:
  `emitter.integration.test.ts:236` (union no longer in `FieldOutputTypes` text —
  assert codec-output fallback there + the union via the lane), and the
  `generateBothFieldTypesMaps` enum unit test
  (`domain-type-generation.test.ts:1258`).
- **Verify:** retail-store type-checks (non-enum map consumer); demo anchor green
  unmodified; regenerate `.d.ts` fixtures (enum `FieldOutputTypes` entries now
  show codec output); `contract.json` still byte-identical; no-bare-cast ratchet
  clean.

## Review & validation per unit

Each dispatch returns: the diff summary, the new/updated tests and their results,
the `fixtures:check` / hash-stability evidence, and a typecheck pass. Reviewer
(opus) checks against the spec's done conditions before the next unit dispatches.
After U3: full `pnpm build` + `pnpm typecheck` + `pnpm fixtures:check` + affected
package suites, then open the PR (`create-pr` skill, title prefixed `TML-2886:`).

## Decision D1 (during build — see reviews/code-review.md)

The no-emit (`typeof contract`) path carries no literal `valueSet` ref at the type
level, so U2 implemented `ref → baked-map → codec` in all lanes (emitted path
ref-follows; no-emit path falls back to the authoring-time map). **U3 is re-scoped:**
retire only the **emitter's** enum override (`EnumValuesResolver` +
`generateBothFieldTypesMaps` fork) — this forces the emitted path to rely solely on
the ref (kills the false-green risk that the fallback masks a ref bug). Do **not**
touch the authoring-ts no-emit enum narrowing; the `enum-surface.*` no-emit tests
stay green. Reviewer verifies the blast radius first.

## Open items (follow-up, out of this slice)

- Make the no-emit authoring-ts path carry literal `valueSet` refs on storage
  columns / domain fields, so the lanes can drop the baked-map fallback entirely and
  the no-emit path ref-follows too (full §5 "no baked map"). Separate contract-ts
  change; file a ticket at slice close.

## Risk notes (from discovery)

- `FieldOutputTypes`/`FieldInputTypes` are **not** deletable — only the enum fork
  is. retail-store and the parameterized-codec path depend on the maps.
- Both refs already live in `contract.json`; emission is `.d.ts`-only. Any
  `contract.json`/hash move means a mistake — halt.
- The query-builder path must not require a domain field to exist (raw value-set
  columns).
</content>
