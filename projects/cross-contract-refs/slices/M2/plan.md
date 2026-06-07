# M2 — Authoring surfaces: dispatch decomposition

Slice goal + scope + grounded anchors: see `slices/M2/spec.md`. One PR; persistent implementer
(sonnet) + reviewer (opus) resumed across all dispatches. TDD mandatory. Standing validation gate
per dispatch is in the slice spec.

Sequence (each builds on the prior; shared IR-input types added early so later dispatches consume
them): **M2.1 → M2.2 → M2.3 → M2.4 → M2.5.**

ACs: M2.1 → AC1(storage half)/AC4/AC5(TS); M2.2 → AC1(relation/non-navigable half);
M2.3 → AC1(real-extension end-to-end); M2.4 → AC2(lowering)/AC3(authoring)/AC5(PSL);
M2.5 → AC2(round-trip). AC9 regression + AC10 guarded every dispatch.

## Dispatch M2.1 — TS brand foundation + cross-space FK (storage plane)

- **Outcome:** `ColumnRef<TSpaceId>` brand added; local model handles branded `<self>`, and the
  branding mechanism is in place for extension handles to carry their `spaceId`.
  `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` accepts a cross-branded target and lowers
  to a storage `ForeignKeyReference` whose `spaceId` is the target's brand; local refs are unchanged
  (no `spaceId`). The local-only FK target gates (`assertKnownTargetModel` `build-contract.ts:119`;
  FK resolution `contract-lowering.ts:256`/`:538`) are relaxed for branded cross-space targets —
  for a cross-space target, skip the local-model lookup and carry the brand's coordinate through.
  `ForeignKeyNode.references` (`contract-definition.ts:46`) gains `spaceId?`. A **missing-pack
  fail-fast** check (new `assertKnownExtensionPack`-style helper, modelled on `assertKnownTargetModel`)
  throws when a referenced brand's `spaceId` is not in `definition.extensionPacks`, naming the pack.
  `onDelete:'cascade'` on a cross-space FK emits **no** diagnostic.
- **Builds-on:** nothing (first M2 dispatch; lands the shared brand + `ForeignKeyNode.references.spaceId`).
- **Hands-to:** M2.2 (relation carriers + emitter), M2.4 (PSL reuses `ForeignKeyNode.references.spaceId`).
- **Focus:** `contract-dsl.ts` (ColumnRef brand, model-handle brand, `foreignKey` signature),
  `contract-lowering.ts` + `build-contract.ts` (relax gates, set `spaceId`, missing-pack throw),
  `contract-definition.ts` (`ForeignKeyNode.references.spaceId?`). Tests in `contract-ts`:
  a synthetic two-contract fixture (define a branded extension handle in-test) → assert the lowered
  storage FK carries `spaceId`; missing-pack throws naming the pack; cascade emits no diagnostic;
  a local FK is byte-identical (no `spaceId`) — NFR2 / AC9 regression.
- **dispatch-INVEST:** Small if the brand + storage-FK lowering stay one concern; if WIP shows the
  type-level brand work alone fills a session, split brand-foundation out (re-plan).

## Dispatch M2.2 — TS cross-space relation (Option B, non-navigable) + emitter

- **Outcome:** the domain-plane relation carriers gain a foreign `spaceId`: `TargetFieldRef`
  (`contract-dsl.ts:529`), `RelationModelSource`/`BelongsToRelation` (`:418`/`:422`), `RelationNode`
  (`contract-definition.ts:67`), and `CrossReference`
  (`framework/0-foundation/contract/src/cross-reference.ts`, add `space?`). `lowerBelongsToRelation`
  (`contract-lowering.ts:306`, throw at `:316`) is relaxed: for a branded cross-space target, resolve
  the relation from the brand instead of requiring a local spec, and tag the `RelationNode` with the
  foreign `spaceId`. The emitter `generateModelRelationsType`
  (`…/domain-type-generation.ts:101`) renders a cross-space relation **non-navigable** (emit
  `never` for its include surface) so `db.<ns>.<Model>.find({ include: { <rel>: true } })` is a
  **compile-time error**, while the relation still appears in the contract and drives the FK.
- **Builds-on:** M2.1 (brand + storage FK; the relation reuses the same brand signal).
- **Hands-to:** M2.3 (supabase handles exercise both FK + relation), M2.4 (PSL domain relation reuses
  `CrossReference.space`).
- **Focus:** `contract-dsl.ts`, `contract-definition.ts`, `cross-reference.ts`, `contract-lowering.ts`,
  the emitter `domain-type-generation.ts`. Tests: synthetic fixture → cross-space relation present in
  IR with `spaceId`; **negative type test** that `include` of the cross-space relation is a compile
  error (vitest `expect-typeof` / `@ts-expect-error` in a type test); a local relation stays navigable.
- **dispatch-INVEST:** Small (relation carriers + one emitter seam + type tests).

## Dispatch M2.3 — Supabase extension `/contract` branded handles

- **Outcome:** `@prisma-next/extension-supabase` exposes a `/contract` subpath exporting branded
  model handles (`AuthUser`, `AuthIdentity`, `StorageBucket`, `StorageObject`) — `ContractModelBuilder`
  handles branded with `spaceId: 'supabase'`, each with `.refs`. `package.json` `exports` + tsdown
  build wired so `import { AuthUser } from '@prisma-next/extension-supabase/contract'` resolves.
- **Builds-on:** M2.1/M2.2 (the brand mechanism the handles must carry).
- **Hands-to:** slice end-to-end (these are what an app imports; M3 walking skeleton + extension-supabase
  consume them).
- **Focus:** `packages/3-extensions/supabase/` (new `src/contract/handles.ts` or equivalent + `/contract`
  export + build config). Test: import `AuthUser` from `/contract`, assert brand `'supabase'` and
  `AuthUser.refs.id : ColumnRef<'supabase'>`; an app fixture FK + relation to `AuthUser` lowers to
  `spaceId:'supabase'` with the resolved `auth.users.id` coordinate (end-to-end AC1 against the real
  extension).
- **dispatch-INVEST:** Small (handles + export wiring + smoke test). Confirm the brand value matches
  `supabasePack.id`.

## Dispatch M2.4 — PSL colon-prefix: parser + AST + interpreter lowering

- **Outcome:** PSL accepts the colon-prefix in field-type position. `PslField` gains
  `typeContractSpaceId?` (`psl-ast.ts:82`). `parseField` (`parser.ts:750`, ~`:793`) recognises a
  leading `<space>:` before the existing dotted form, accepting `<space>:<ns>.<name>` and
  `<space>:<name>` (no-namespace → `__unbound__`); bare `<ns>.<name>` / `<name>` retain TML-2459
  semantics; nested/invalid forms still error. The interpreter (`interpreter.ts`) threads
  `typeContractSpaceId` into the FK IR `spaceId` (`...ifDefined('spaceId', …)` on the FK node
  `references`, `:1087`) and into the domain relation (`CrossReference.space`), relaxing the
  cross-space relation-target gate (`:968`). A **missing-pack** diagnostic (new
  `PSL_UNKNOWN_CONTRACT_SPACE`, via the `ContractSourceDiagnostic` envelope, pattern
  `reportUncomposedNamespace` `psl-column-resolution.ts:173`) fires when `typeContractSpaceId` names a
  space not in the composition. `@relation(…)` is unchanged.
- **Builds-on:** M2.1 (`ForeignKeyNode.references.spaceId`) + M2.2 (`CrossReference.space`).
- **Hands-to:** M2.5 (printer).
- **Focus:** `psl-ast.ts`, `psl-parser/src/parser.ts`, `contract-psl/src/interpreter.ts`. Tests:
  `psl-parser` parser tests for the three colon-prefix forms + invalid forms (template:
  `parser.test.ts:1100` dotted-type tests); `contract-psl` interpreter tests that the colon-prefix
  lowers to `spaceId` (named ns + `__unbound__` no-namespace form) and the missing-pack diagnostic
  fires (template: `interpreter.namespaces.test.ts:17`); PSL↔TS parity test.
- **dispatch-INVEST:** Small-ish — regex change + AST field + interpreter threading + diagnostics. If
  the interpreter threading proves large, the diagnostic can split out (re-plan).

## Dispatch M2.5 — PSL printer round-trip (colon-prefix + the TML-2459 namespace gap)

- **Outcome:** `fieldToPrinterField` (`ast-to-print-document.ts:205`) renders the qualified
  field-type form: `typeContractSpaceId` + `typeNamespaceId` + `typeName` →
  `space:ns.Name` / `space:Name` / `ns.Name` / `Name`. This **also fixes the pre-existing TML-2459
  bug** where `auth.User` (a `typeNamespaceId`-bearing field) round-trips back to bare `User`
  (scope note in the commit — it is the same code path and AC2 round-trip depends on it).
- **Builds-on:** M2.4 (`typeContractSpaceId` on the AST).
- **Hands-to:** slice DoD (closes AC2 round-trip).
- **Focus:** `psl-printer/src/ast-to-print-document.ts` (+ `serialize-print-document.ts` if the type
  string is assembled there). Tests: `print-psl-from-ast` round-trip for `auth.User`,
  `supabase:auth.User`, `supabase:User`. Stylistic line-wrap of long colon identifiers: keep on one
  line until the column limit (open question in the project spec — pick the simplest readable
  default, note it).
- **dispatch-INVEST:** Small (one printer function + round-trip tests).

## Slice DoD (gate for closing M2)

- AC1–AC5 (authoring halves) + AC9 + AC10 demonstrated by tests through real lowering; Option B
  non-navigability proven by a negative type test.
- All five dispatches reviewer-SATISFIED; trace backstop passes (`--expect-dispatches 5`);
  PR opened against `main`.
- No planner/verifier/live-DB or walking-skeleton-FK code (those are M3).

## Open items (deferred from M2)

- Walking-skeleton `Profile.userId → auth.User.id` live wiring + cascade-delete test — **M3**
  (needs the planner to emit `REFERENCES`).
- PSL printer long-line wrapping of colon-prefixed identifiers — shipped with the simplest readable
  default; revisit on user feedback (project-spec open question).
- `<self>` branding mechanism choice (closure-captured contract id vs post-hoc tagging) — implementer's
  call in M2.1; both satisfy AC behaviour (project-spec open question).
- **FK-target `spaceId` type-surface gap** (surfaced by the M2.3 reviewer). The lowered
  `BuiltStorageTables<Definition>` type omits `spaceId` on the FK target, though the runtime
  `ForeignKeyReference` carries it (a test needed a record cast to read it). Runtime is correct, so M3's
  planner reads it fine; this is a type-level completeness cleanup in `contract-ts`/`sql-contract` —
  candidate for a small follow-up (M3 or a dedicated cleanup), not an M2 blocker.
