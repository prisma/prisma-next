# M2 — Authoring surfaces (TS brands + PSL grammar): slice spec

## Goal

Make the M1 cross-contract FK carrier reachable from user code. After this slice, an app
contract can declare a cross-contract FK + a (non-navigable) cross-space relation in **both**
the TypeScript builder and PSL, and the authoring surfaces lower to the M1 IR shape
(`ForeignKeyReference.spaceId` present ⇒ cross-space). No planner / verifier / live-DB work —
that is M3. One PR.

Branch: `tml-2500-m2-authoring-surfaces` from updated `main` (M1 merged).
Model tiers: implementer = sonnet; reviewer = opus. TDD mandatory.

## In scope

- **TS authoring brand.** `ColumnRef<TSpaceId>` brand parameter; local model handles branded
  `<self>`, extension handles branded with their `spaceId`.
- **TS cross-space FK lowering.** `constraints.foreignKey(cols.x, ExtModel.refs.y, …)` accepts a
  cross-branded target and lowers to a storage `ForeignKeyReference` carrying `spaceId`. Relax the
  local-only target gates (`assertKnownTargetModel`, FK resolution) for branded cross-space targets.
- **TS cross-space relation (Option B).** `rel.belongsTo(ExtModel, …)` lowers to a domain-plane
  relation carrying the foreign `spaceId`; the emitter renders it **non-navigable** so
  `include: { <rel>: true }` is a **compile-time error**.
- **Supabase extension branded handles.** Add a `/contract` subpath to
  `@prisma-next/extension-supabase` exporting branded model handles (`AuthUser`, …) so app code can
  `import { AuthUser } from '@prisma-next/extension-supabase/contract'`.
- **PSL colon-prefix grammar.** `<space>:<namespace>.<name>` and `<space>:<name>` in field-type
  position; `PslField.typeContractSpaceId?`; interpreter threads it into the FK carrier `spaceId`
  and the domain relation; PSL printer renders the colon-prefix (and the pre-existing
  `typeNamespaceId`, see below).
- **Missing-pack fail-fast diagnostic.** A reference to a space not declared in `extensionPacks`
  fails fast at lowering, naming the missing pack — for **both** TS and PSL surfaces.
- **Cascade permitted.** `onDelete: 'cascade'` (and the rest of the action set) on a cross-contract
  FK emits **no** diagnostic at any framework layer.

## Out of scope (deferred to M3 / later)

- Planner DDL emission (qualified vs unqualified `REFERENCES`) and verifier walk — **M3**.
- Live-DB / PGlite integration test, `pg_constraint` assertion, cascade-delete behaviour — **M3**.
- Wiring the `examples/supabase` walking-skeleton `Profile.userId → auth.User.id` FK into the
  running example — **M3** (it needs the planner). M2 proves authoring→lowering via synthetic
  fixtures + the supabase `/contract` handles, not via the live skeleton.
- Runtime cross-space query / relation traversal (`include` semantics) — undesigned, future project.
- Mongo cross-space references — Mongo has no FK concept.

## Decisions to honor (operator-approved, carried from the project spec / M1)

- **Option B — declared, non-navigable cross-space relations.** A cross-space ref declares a
  *relationship* (not just a storage FK) via the unified surface, but the emitted ORM types make
  traversal (`include`) a compile-time error. (Project spec § "Declared, non-navigable cross-space
  relations".)
- **Carrier discriminator = `spaceId` presence.** No `origin`/`source` tag on the storage carrier
  (M1 decision A). Cross-space ⇔ `ForeignKeyReference.spaceId !== undefined`.
- **Unified call shape.** No `refExt` / `belongsToExternal` — the brand on the handle is the only
  signal. (FR4.)
- **Implicit resolution via `extensionPacks`.** No PSL `use` directive, no TS resolver call. (FR10.)
- **Cascade across the boundary: no diagnostic.** Explicit opt-in is the audit trail. (FR6 / AC4.)

## Grounded anchors (from the 2026-06-07 investigation; correct the project plan where noted)

TypeScript (`packages/2-sql/2-authoring/contract-ts/src/`):
- `ColumnRef<FieldName>` — `contract-dsl.ts:524`. Currently **no** space brand; add `TSpaceId`.
- `constraints.foreignKey` — `contract-dsl.ts:721`. `ForeignKeyConstraint` (`:605`) carries no `spaceId`.
- `TargetFieldRef` (`:529`), `RelationModelSource`/`BelongsToRelation` (`:418`/`:422`),
  `RelationNode` (`contract-definition.ts:67`) — **none** carry `spaceId` today.
- Lowering gates that reject non-local targets: `lowerBelongsToRelation` throw at
  `contract-lowering.ts:316`; FK resolution throws at `contract-lowering.ts:256` and `:538`;
  `assertKnownTargetModel` at `build-contract.ts:119` (called `:399` FK, `:497` relation).
- `model(...)` factory → `ContractModelBuilder` (`contract-dsl.ts:986`/`:1272`); `.refs` typed
  `ModelTokenRefs`. **No** existing `<self>`/spaceId brand anywhere.
- `ForeignKeyNode.references` (`contract-definition.ts:46`) carries only `namespaceId?` — **add
  `spaceId?`** to thread the carrier.
- Domain `CrossReference` (`packages/1-framework/0-foundation/contract/src/cross-reference.ts`)
  carries `{ namespace, model }` — **add `space?`** for the cross-space relation.

Emitter (Option B seam):
- `generateModelRelationsType` (`…/domain-type-generation.ts:101`) emits the `relations` block of
  the generated `.d.ts`; ORM navigability is driven by `RelationNames`/`RelationsOf` in the orm
  `types.ts`. Make a cross-space relation **non-navigable** by emitting it as `never` (preferred —
  gives a clear error) rather than silently omitting.

Supabase extension (`packages/3-extensions/supabase/`):
- No `/contract` subpath export today; `contract.d.ts` defines `AuthUser` etc. but they are not
  exported. `supabasePack.id === 'supabase'` is the space identity (no `spaceId` field on the pack
  ref type). M2 adds the `/contract` export with branded handles.

PSL:
- **No lexer change needed** — `:` is already a `Colon` token (`psl-parser/src/tokenizer.ts:1`),
  and `parseField` is **regex-driven** (`parser.ts:750`); extend the regex for a leading
  `<space>:` prefix (insertion ~`:793`, before the dot-count guard).
- AST: add `typeContractSpaceId?` to `PslField` (`framework-components/src/control/psl-ast.ts:82`);
  `typeNamespaceId?` already exists (TML-2459).
- Interpreter lowering: `contract-psl/src/interpreter.ts` — thread `typeContractSpaceId` into the FK
  IR `spaceId` (FK node assembly `:1087`) and the domain relation; relax the cross-space
  relation-target gate (`:968`); missing-pack diagnostic via the `ContractSourceDiagnostic` envelope
  (pattern: `reportUncomposedNamespace` in `psl-column-resolution.ts:173`), new code
  `PSL_UNKNOWN_CONTRACT_SPACE`.
- **Printer pre-existing gap:** `fieldToPrinterField` (`psl-printer/src/ast-to-print-document.ts:205`)
  currently drops `typeNamespaceId` on round-trip (a TML-2459 bug). AC2 round-trip forces fixing
  **both** `typeNamespaceId` and `typeContractSpaceId` rendering together — fold the `auth.User`
  round-trip fix into the printer dispatch with a scope note.

AST field name correction: the project spec says `typeContractSpace?`; the actual sibling field is
`typeNamespaceId?`, so use **`typeContractSpaceId?`** for consistency.

## Acceptance criteria owned by M2

- **AC1** — TS app contract references an extension model/column with the same call shape as local;
  IDE autocompletes `AuthUser.refs.<Tab>`; lowering produces `source:'space'` (`spaceId` present)
  with resolved coordinates; the cross-space relation is **declared but non-navigable**
  (`include` of it is a compile error).
- **AC2** — PSL `user supabase:auth.User @relation(…)` lowers to the same carrier as AC1; authoring →
  contract.json → re-hydrated IR preserves the coordinate (round-trip, incl. printer).
- **AC3 (authoring half)** — PSL `supabase:User` (no-namespace form) lowers to a carrier with
  `namespace: __unbound__`. (Planner emitting unqualified `REFERENCES` is M3.)
- **AC4** — cross-contract FK with `onDelete:'cascade'` is permitted; no diagnostic at any layer.
- **AC5** — referencing an extension model without declaring it in `extensionPacks` fails to load
  with a diagnostic naming the missing pack; verified for **both** TS and PSL.
- **AC9 (regression)** — existing TML-2459 local cross-namespace FK tests pass unchanged.
- **AC10** — `pnpm lint:deps` + cast ratchet clean; no new layering violations.

(AC6/AC8 landed in M1; AC7 + the planner half of AC3 land in M3.)

## Standing validation gate (per dispatch — M1 babysit lessons)

Every dispatch must, before the reviewer is engaged:
1. `pnpm --filter <changed-pkg> build` for each changed package, then **rebuild dependent `dist`**
   before any downstream test (cross-package type changes are stale-dist footguns).
2. `pnpm typecheck` + the package test command(s) covering the touched surface.
3. `pnpm lint:deps` + `pnpm lint:casts` (delta ≤ 0) + **full `pnpm lint`**
   (`biome check --error-on-warnings`).
4. `pnpm fixtures:check` (the emitter/PSL changes must not churn existing fixtures — no cross-space
   ref exists in any fixture yet, so fixtures should be unchanged).
5. Worktree caveat: `examples/supabase` and some mongo packages may fail locally on missing
   deps/build — CI's clean env is the arbiter for those; do not treat them as M2 regressions unless
   the diff touches them.

Trace events are emitted **live** per dispatch/round (never back-filled).

## Slice DoD

- AC1–AC5 (authoring halves), AC9 regression, AC10 demonstrated by tests through real lowering.
- Option B non-navigability proven by a negative type test (`include` of a cross-space relation is a
  compile error) and a positive test (a local relation stays navigable).
- Reviewer SATISFIED across all dispatches; trace backstop passes; PR opened against `main`.
