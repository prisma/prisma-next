# D2 — Family lowering + emitter typegen + downstream consumers + codec-alias relocation

**Slice spec:** [`../spec.md`](../spec.md). **Slice plan:** [`../plan.md`](../plan.md) § D2. **D1 commit:** `56da368c4`. **Linear:** [TML-2624](https://linear.app/prisma-company/issue/TML-2624)[^1].

[^1]: Slice ticket canceled 2026-05-20; tracking via parent [TML-2584](https://linear.app/prisma-company/issue/TML-2584). PR titles still prefix the slice id.

## Intent

D1 landed the framework cross-reference shape (`CrossReference`, `NamespaceId` brand, validators tightened, family serializer hydration confirmed as passthrough). D2 lands the producer + consumer migration: authoring lowering (SQL + Mongo; TS DSL + PSL) emits `{ namespace, model }` pairs from in-scope handle namespaces; emitter typegen renders the new `.d.ts` shape; downstream consumers (ORM-client, query-builders, Mongo emitter base resolution, framework canonicalization-adjacent walks) read the pair via `.model`. Codec-aliases relocate from `storage.types` to `domain.__unbound__.types` (Decision E).

After D2: `pnpm typecheck` + `pnpm test:packages` green across framework, authoring, emitter, and downstream-consumer packages. `pnpm test:integration` and `pnpm fixtures:check` remain red on stale on-disk fixtures — D3 regen flushes.

## Pre-locked decisions (do not re-litigate)

- **E — Codec-alias destination is `domain.__unbound__.types`.** Codec-aliases are document-scoped and don't anchor to a user-declared namespace. The `UNBOUND_NAMESPACE_ID` sentinel already exists at [`packages/1-framework/1-core/framework-components/src/ir/namespace.ts:26`](../../../../../packages/1-framework/1-core/framework-components/src/ir/namespace.ts); reuse it. The brief-assembly audit of the demo's `Embedding1536` confirmed no user-authored TS references `storage.types.<X>` directly. *Rejected:* per-namespace `domain.<ns>.types` placement (forces a synthetic host namespace for globally-available bindings).
- **F — User-facing DSL signatures don't change.** `belongsTo` / `extends` / `roots` keep their existing shapes; lowering reads handle namespaces from existing in-scope maps (SQL DSL has `tableNameToNamespaceId`; SQL PSL has `modelNamespaceIds`). String-form overloads resolve via the same maps; ambiguous bare-string targets raise `ContractValidationError` (no implicit-same-namespace fallback). *Rejected:* implicit fallback (re-introduces the silent-collision branch ADR Decision 4 rejected).
- **G — Emitter typegen hard-cut; D3 regen flushes.** D2's emitter produces the new object-pair `.d.ts` shape; on-disk regeneration is D3. No deprecation shim. *Rejected:* dual-emit union `'X' | { namespace, model }` (F1).
- **H — Consumers walk the pair; lookup still hits flat `contract.models` via `.model`.** Every site that reads `relation.to` / `model.base` / `roots[k]` extracts `.model` and looks up against the still-flat `contract.models` tree (D1 kept it flat; D2 does not move it). No `Contract.crossReferences` index, no `flatModelsAdapter`. *Rejected:* registry-style indirection (F6).

## Scope boundary

- **In:** authoring lowering (SQL+Mongo, TS+PSL), emitter typegen (`generateRootsType`, `generateModelRelationsType`, `generateModelsType` model.base path), downstream consumers (SQL ORM-client, Mongo query-builders + ORM, Mongo emitter base resolution, SQL PSL interpreter's own roots filter), codec-alias relocation (authoring writes + framework canonicalization + emitter typegen + sql-context.ts transitional dual-read), test fixture pins, functional gate extension (D1 reviewer carry-over #2).
- **Not in (D1 territory):** framework cross-ref type, `NamespaceId` brand, validators, FK reference type tightening, family serializer hydration, `validate-domain.ts` (D1 updated), Mongo `validate-storage.ts` (D1 updated). If you find yourself editing D1 surfaces, HALT.
- **Not in (D3 territory):** fixture regen (`pnpm fixtures:emit`), any `.json` / `.d.ts` under `examples/` / `test/fixtures/` / `packages/**/test/fixtures/`, slice validation gate, PR open.
- **Not in (S1.E territory):** planner-strategies enum collision paths. Column `typeRef` stays a bare string in D2 (slice spec pre-audit; S1.E owns the narrowing).
- **Not in:** plural slot rename ([TML-2634](https://linear.app/prisma-company/issue/TML-2634)), namespace `.entries` redirect ([TML-2636](https://linear.app/prisma-company/issue/TML-2636)), SQLite Postgres-enum cleanup ([TML-2667](https://linear.app/prisma-company/issue/TML-2667)).

## D1 reviewer carry-overs to fold in

- **#1** — `packages/2-mongo-family/9-family/test/mongo-contract-serializer-base.test.ts` has 3 failing tests on bare-string `roots: { items: 'Item' }`. Wrap via `crossRef('Item')` (or equivalent helper if introduced).
- **#2** — Extend D1's functional round-trip test to cover `relation.to` and `model.base` in addition to `roots`. ≤ 15 LoC.
- **#3** — The `as Type<ForeignKeyReferenceInput>` cast at SQL `validators.ts:137` persists; arktype's `'string'` cannot infer the `NamespaceId` brand and Decision A keeps the brand compile-time-only. Do **not** attempt to "fix" it.

## Done when

- Lockfile clean: `pnpm install --frozen-lockfile` passes (no `test-NNNN-*` importers, no `@prisma-next/*@0.10.0` published refs).
- Stale-dist pre-flight: `rm -rf .turbo && pnpm build --force` ran before any typecheck (S1.B retro inheritance, two instances).
- `pnpm typecheck` green across framework + authoring + emitter + downstream-consumer packages (including `@prisma-next/emitter` which was D1-deferred).
- `pnpm lint:deps` clean.
- `pnpm test:packages` green for: framework, sql-core, family-sql, family-mongo, SQL TS DSL + PSL, Mongo TS + PSL, emitter, SQL ORM-client, Mongo query-builders. Integration + fixtures:check expected red on stale fixtures — call out, do not regen.
- Functional gate (extended): hand-rolled cross-reference round-trips through validator + family serializer hydration for all three Decision-B call sites (`relation.to`, `model.base`, `roots[*]`).
- Producer grep: `rg "to:\s*[a-z]*[Mm]odelName\b|base:\s*[a-zA-Z]*Decl\.baseName" packages/2-sql/2-authoring/ packages/2-mongo-family/2-authoring/ --glob '!**/dist/**' --glob '!**/test/**'` → zero hits.
- Emitter grep: `rg "readonly to: '[A-Z]|readonly base: '[A-Z]" packages/1-framework/3-tooling/emitter/src/` → zero hits.
- Codec-alias grep: lowering writes go to `domain.__unbound__.types` only — no `storage.types[…] =` or `storage.types: {` writes for codec-aliases in authoring source.
- Carry-over #1 fixtures green; carry-over #2 test extension present and green.

## Refusal triggers (halt — do not work around)

- Transitional `to: string | { namespace, model }` union at any layer (F1, Decision G).
- New framework registry: `flatModelsAdapter`, `Contract.crossReferences`, runtime `NamespaceId` validator (F6, Decisions A + H).
- **Mongo lowering context lacks a model→namespace map equivalent to SQL's `tableNameToNamespaceId` / `modelNamespaceIds`.** Building one from scratch is a structural addition that belongs in a separate discussion-mode round. HALT and surface.
- Codec-alias relocation surfaces > 8 production files beyond cross-ref encoding, OR cascades into user-authored TypeScript (demo TS / extension pack / public API consumer reads `storage.types.<X>`). HALT — spec OQ#5 authorises defer to a follow-up slice.
- `git diff --stat` > 18 files under `packages/` OR typecheck cascade pulls > 25 files. HALT, request D2a (cross-ref encoding) + D2b (codec-alias) split.
- Any edit to D1 surfaces (framework cross-ref type, `NamespaceId` brand, SQL/Mongo validators, FK reference type, family serializer bases). HALT.
- `pnpm fixtures:emit` triggered, or any `.json` / `.d.ts` under `examples/` / `test/fixtures/` edited. HALT, D3 territory.
- S1.E planner-strategies enum collision paths edited (column `typeRef` encoding, `locateNamespaceType`, `collectPostgresEnumTypes`). HALT.
- F5: no `git reset --hard`, no force-push, no `git checkout --` on un-staged work.
- F7: hitting an unbriefed structural blocker (Turbo cycle, lint:deps refusal, hidden circular import) and considering a workaround that crosses a layering boundary. HALT and report; do not alias / `dependsOn` / re-export.

## Model tier

Executor: **Composer-2.5** (`composer-2.5-fast`). Settled-decisions brief; lowering paths are mechanical re-shapings of existing output; codec-alias relocation is a slot move at producer/consumer level. No design-judgment surface.

Reviewer: **Opus 4.7** (`claude-opus-4-7-thinking-high`). Reviewer Section C is **"Functional gate inspection"** — read the test file, judge the assertion shape and coverage (all three call sites covered; byte-equal round-trip). Do **not** execute the test (2026-05-27 reviewer-prompt retro).

Escalate executor to Opus 4.7 if: Mongo lowering namespace map equivalence falsifies Decision F for Mongo; lowering produces a pair that doesn't round-trip through D1's validator; consumer surface requires structural API redesign beyond `.model` extraction or thin helper widening; Risk #5 (a)+(b) cannot be answered for a proposed surface.

## Wrap-up format

1. HEAD SHA + push confirmation.
2. Pre-flight evidence: `pnpm install --frozen-lockfile` exit + `pnpm-lock.yaml` diff summary; `pnpm build --force` exit.
3. Done-when gate results (PASS / FAIL / N/A with one-line evidence each).
4. `git diff --stat` file count; typecheck-cascade file count if it spiked.
5. Decisions E / F / G / H — implemented-as-specified or deviation with rationale.
6. Refusal-trigger fires (or explicitly "none").
7. D1 reviewer carry-overs status (#1 mongo fixtures / #2 functional gate / #3 cast unchanged).
8. **Handoff stub for D3:** files that need fixture regen; codec-alias dual-read status in `sql-context.ts` (single-read achievable post-D3 regen? or needs follow-up dispatch?); consumer-helper widening choice taken (callsite `.model` extraction vs widened helpers).

## References

- D1 brief: [`./01-framework-shape.md`](./01-framework-shape.md) — Decisions A/B/C/D inherited.
- Slice spec / plan: [`../spec.md`](../spec.md), [`../plan.md`](../plan.md). Spec OQ#5 authorises codec-alias defer-to-follow-up if cascade > 8 production files.
- ADR: [`../../../adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) — Decisions 1 (planes), 4 (object-pair cross-refs), 5 (slot naming + codec-aliases as domain-side), 6 (entity coordinate).
- Calibration: [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md), [`sizing.md`](../../../../../drive/calibration/sizing.md), [`model-tier.md`](../../../../../drive/calibration/model-tier.md).
- Retros: [`drive/retro/findings.md`](../../../../../drive/retro/findings.md) (2026-05-21 Risk #5 root cause + 2026-05-22 stale-dist + S1.B D2-R2 lockfile-leak + 2026-05-27 reviewer-prompt + 2026-05-27 brief gigantism).
