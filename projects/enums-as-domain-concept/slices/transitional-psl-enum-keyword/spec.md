# Slice: transitional-psl-enum-keyword

Parent project: `projects/enums-as-domain-concept/`. Contributes the project's
**activation**: the new enum mechanism becomes PSL-authorable additively, goes live
through the product path (PSL → emit → app) in the demo, and shrinks the cutover
(TML-2853) to rename + migrate + delete.

## At a glance

A new top-level PSL block, spelled `enum2`, authors the new domain-concept enum directly
in a schema while native `enum` keeps working untouched:

```prisma
enum2 Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}

model Post {
  priority Priority
}
```

It lowers to the already-merged new shape — domain `enum` + storage `valueSet` +
field/column `valueSet` refs + check constraint — by constructing the same
`EnumTypeHandle`s the TS `enumType` path feeds into `buildSqlContractFromDefinition`,
so the lowering itself is 100% reuse. The demo authors `enum2 Priority` in its PSL
schema, re-emits, adds the migration, and gains a `main.ts` command that consumes the
enum through the real emitted contract (typed value-union reads, `db.enums`,
declaration-order `ORDER BY`).

**Naming (settled here, per plan):** the transitional spelling is **`enum2`**. It is
explicitly temporary (retired at the TML-2853 cutover, which renames it to `enum`), and
any nicer-sounding alternative (`valueEnum`, `domainEnum`) would invent semantics for a
keyword whose whole point is to die. Operator may override before dispatch.

## Chosen design

Four surfaces; the only genuinely new piece is grammar (and the cutover needs that
grammar anyway).

**1. Grammar — psl-parser (`packages/1-framework/2-authoring/psl-parser/src/parser.ts`).**
A dedicated `enum2` block parse alongside the native `enum` parse (~line 148), producing
a **distinct AST node kind** (e.g. `PslEnum2` with members `{ name, rawValue?, span }`)
so the native `PslEnum` AST is untouched. Three grammar elements:

- Block keyword: `enum2 <Name> {`.
- Member syntax: `Name = <literal>` — the RHS is the codec's **JSON-encoded value**,
  captured raw (validated later against the codec, not in the parser). The `= value` is
  optional: it defaults to the member name for string-input codecs. No `@map` on
  members (that is native-enum vocabulary; the design notes reject `@map` for member
  values as a plane miscategorization).
- Block attribute: `@@type("<codec-id>")`, reusing the existing block-attribute parse
  the native enum already has (~lines 500–550).

Not the generic extension-block path (parser.ts ~224): extension blocks parse
`key = value` member lines but do **not** support `@@` block attributes, and `@@type` is
required here. A dedicated parse matches how `enum` works today and gives precise spans
for diagnostics.

**2. Interpreter — contract-psl (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`).**
A parallel `processEnum2Declarations` next to the native `processEnumDeclarations`
(line 312). Per `enum2` declaration it:

- Looks up the **`entityTypes.enum2`** contribution via `getAuthoringEntity`
  (`psl-column-resolution.ts:90`); a missing contribution is a clean
  target-doesn't-support-this diagnostic (the native-enum precedent, interpreter.ts:323).
- Validates `@@type` is present (required, never inferred — validation error if absent)
  and resolves the codec id through the codec lookup.
- Validates each member RHS with `JSON.parse` + `codec.decodeJson` — the existing
  PSL-extension `value`-parameter pattern in
  `framework-components/src/control/psl-extension-block-validator.ts` (~190–216),
  emitting `PSL_EXTENSION_INVALID_VALUE`-style diagnostics on a non-JSON literal or a
  codec-rejected value. Missing `= value` defaults to the member name where the codec
  accepts a string; otherwise a diagnostic.
- Enforces well-formedness (non-empty, unique names, unique values) — mirroring
  `enumType`'s construction asserts.
- Produces, per enum: an **`EnumTypeHandle`** (the shape
  `buildSqlContractFromDefinition` already consumes) and a **`ColumnDescriptor`** entry
  in the existing by-name descriptor map (`enumTypeDescriptors`,
  `psl-column-resolution.ts:823`) so field resolution (`priority Priority`) is
  **unchanged** — it neither knows nor cares which block declared the name.

The resolved field carries the handle via the existing optional
`FieldNode.enumTypeHandle` (`contract-ts/src/contract-definition.ts:29`), and the
handles are passed as `enums` into `buildSqlContractFromDefinition` (interpreter.ts:2151
already calls it). From there **everything is the merged TS-path lowering**: domain
`enum` + storage `valueSet` registries (`build-contract.ts:754–787`), field/column
`valueSet` refs (448–471), and the check constraint derived from the column's
`valueSet` (561–568). Zero new lowering code.

**3. Postgres pack (`packages/3-targets/3-targets/postgres/src/core/authoring.ts`).**
Register the `enum2` entry in `postgresAuthoringEntityTypes` (next to the native `enum`
entry, lines 43–53). Its job differs from native's (which fabricates a
`PostgresEnumStorageEntry`): the `enum2` contribution marks the target as supporting
the block and binds it to the target's codec set. Exact factory I/O shape is a
dispatch-time call; the contract is (a) absence ⇒ clean diagnostic, (b) presence
supplies what the interpreter needs to resolve the `@@type` codec id.

**4. Demo (`examples/prisma-next-demo`).** Author `enum2 Priority` (the same three
members the TS-path `Priority` in `prisma/contract.ts` has) in
`src/prisma/contract.prisma`; re-emit (`pnpm emit`) so `src/prisma/contract.json` +
`contract.d.ts` carry the enum and the field's value union (the TML-2852 emit-time
narrowing); add the migration under `migrations/app/` (new `Priority` value-set +
`priority` column + check on `posts`); add a `main.ts` subcommand that consumes the
enum **through the emitted contract** — typed read (`'low' | 'high' | 'urgent'`),
`db.enums.public.Priority.values`, and an `ORDER BY priority` that returns
declaration order. This is the proof the slice ships live, not dark.

## Coherence rationale

One outcome a reviewer holds in one sitting: *"the new enum is now authorable through
PSL and live in the demo's real emitted-contract app, with native `enum` untouched."*
The grammar, the interpreter path, the pack registration, and the demo usage are one
vertical — each is inert without the others, and the lowering they feed is entirely
already-merged code. ~500 lines + tests (feasibility investigated 2026-06-10).

## Scope

**In:** `enum2` block grammar (keyword, `Name = value` members, `@@type` block
attribute) + AST node + parser tests; the interpreter's parallel declaration path
(contribution lookup, codec/value validation, handle + descriptor production) +
interpreter tests proving the emitted contract carries domain enum, storage value-set,
field/column refs, and check; the Postgres `entityTypes.enum2` registration; the demo
vertical (PSL authoring, re-emitted artifacts, migration, consuming `main.ts` command).

**Out:**
- Member defaults — PSL `@default(member)` on an enum2 field is TML-2855 (sequenced
  directly after this slice).
- The `enum2` → `enum` rename, PSL `enum` repoint, and native-machinery deletion —
  TML-2853 (cutover).
- Numeric-codec SQL rendering (CHECK / `ORDER BY` for non-text value-sets) — stays
  guarded; tracked separately. The grammar accepts any codec-input JSON on the RHS, but
  the demo and integration coverage use `pg/text@1`.
- Namespace-scoped `enum2` (`namespace x { enum2 … }`) — the TS path registers authored
  enums only under the contract's default namespace (`build-contract.ts:755`); `enum2`
  matches that. A namespaced `enum2` gets a clear not-supported diagnostic, not silent
  mis-registration.
- Mongo — TML-2884 owns Mongo's PSL `enum` (Mongo skips the transitional keyword
  entirely).

## Contract-impact

None structurally — the emitted shape is exactly the TML-2850/2851/2852 shape the TS
path already produces; this slice only adds a second authoring surface that reaches it.
Additive: no existing fixture authors `enum2`, so `fixtures:check` stays zero-diff
except the demo's own re-emitted artifacts, which change deliberately (that's the
point). Native `enum` lowering is byte-for-byte untouched.

## Adapter-impact

Postgres only, and only the authoring-contributions surface (one `entityTypes.enum2`
registration). No renderer, planner, or runtime adapter changes — those landed in
TML-2851/2852.

## ADR pointer

None authored here. The transitional-keyword decision and its alternatives (discriminate
on `@@type` within `enum`; wait for the atomic cutover) are recorded on
[TML-2882](https://linear.app/prisma-company/issue/TML-2882) and in the project plan's
sequencing rationale; the keyword is deleted at cutover, so it never becomes
architecture.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `enum2` name collides with a native `enum` name | Diagnostic (duplicate type name) | Both feed the same by-name `enumTypeDescriptors` map; a silent last-write-wins would mis-type fields. Assert the collision diagnostic in interpreter tests. |
| Missing `@@type` | Validation error, never inferred | Project spec R1. |
| Member RHS not valid JSON / rejected by codec | `PSL_EXTENSION_INVALID_VALUE`-pattern diagnostic with member span | Reuses the extension-block value validation path; do not invent a new diagnostic mechanism. |
| Bare member (`Low`) under a non-string codec | Diagnostic (value required) | Name-as-default-value only works where the codec accepts the string. |
| psl-printer round-trip | Dispatch-time check | The printer prints native enums (`serialize-print-document.ts:273`). Confirm whether any in-scope flow (migration snapshots, `emit:check`) round-trips the demo schema through the printer; if yes, add minimal `enum2` printing, else leave it for the cutover. |

## Slice-specific done conditions

- [ ] An interpreter test proves PSL `enum2` + a using field emits the same contract
  JSON (domain enum, storage value-set, field/column `valueSet` refs, table check) as
  the equivalent TS `enumType` authoring.
- [ ] The demo's `main.ts` command works against the **emitted** contract: the field
  reads as the value union (type-test), `db.enums.public.Priority` returns the ordered
  tuple, and `ORDER BY priority` returns declaration order (not lexical) — per the
  project's verify-through-emit lesson, not via `typeof` on an in-memory definition.
- [ ] Native `enum` paths are untouched: existing native-enum fixtures and the demo's
  `user_type` keep emitting byte-identical output.

## Open Questions

1. **`entityTypes.enum2` factory I/O shape.** Working position: the contribution's
   presence is the support check and it supplies codec resolution; whether its factory
   returns the `EnumTypeHandle` itself or the interpreter constructs the handle after a
   validate-only contribution call is a dispatch-time call (keep whichever needs fewer
   casts and keeps `EnumTypeHandle` construction in one place).
2. **Codec lookup plumbing.** The interpreter needs a `CodecLookup` for
   `decodeJson` validation (the extension-block validator already receives one;
   `buildSqlContractFromDefinition` already takes one for `encodeViaCodec`). Confirm at
   dispatch time where the interpreter's lookup comes from and thread it; don't build a
   second registry.
3. **Demo migration authoring.** Confirm the demo's migration-folder convention
   (`migrations/app/<stamp>_<name>/` with contract snapshots + ops) is producible via
   the existing CLI flow for this change; hand-author only what the convention requires.

## References

- Parent: `projects/enums-as-domain-concept/spec.md` (R1 PSL half; components 1–5) +
  `design-notes.md` (§ PSL surface — the `=` value + `@@type` decision and the `@map`
  rejection) + `plan.md` (stack position 2).
- Linear: [TML-2882](https://linear.app/prisma-company/issue/TML-2882)
- Surfaces (grounded): `psl-parser/src/parser.ts` (~148 enum block, ~224 extension
  blocks, ~500–550 block attributes); `contract-psl/src/interpreter.ts` (312
  `processEnumDeclarations`, 1969 contribution lookup, 2151
  `buildSqlContractFromDefinition` call); `contract-psl/src/psl-column-resolution.ts`
  (43 `ColumnDescriptor`, 90 `getAuthoringEntity`, 823 by-name resolution);
  `contract-ts/src/build-contract.ts` (444–471 field refs, 561–568 checks, 754–787 enum
  registries); `contract-ts/src/contract-definition.ts` (29 `FieldNode.enumTypeHandle`);
  `contract-ts/src/enum-type.ts` (`EnumTypeHandle`);
  `postgres/src/core/authoring.ts` (43–53 `postgresAuthoringEntityTypes`);
  `framework-components/src/control/psl-extension-block-validator.ts` (~190–216 value
  validation); `examples/prisma-next-demo` (`src/prisma/contract.prisma`,
  `prisma/contract.ts` Priority, `package.json` emit scripts, `migrations/app/`).
- Merged prerequisites: TML-2850 `b661ee117`, TML-2851 `60b2ed9e6`, TML-2852
  `dc72201bc`.
