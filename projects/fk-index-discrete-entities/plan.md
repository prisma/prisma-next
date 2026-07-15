# FK1 — Dispatch plan

One slice, one PR. Test-first shape: red suite → surgical substrate change → repo-wide re-emit + verify. Sequential; each builds on the prior's hand-off. Spec: [`spec.md`](spec.md).

## D1 — Red emit-level suite pinning the target shape

**Outcome:** the contract package has tests that emit a contract from FK authoring inputs and assert the *persisted* shape, and they fail today.

- A FK with a default (or `index: true`) backing index emits a `foreignKeys[]` entry with **no** `constraint`/`index` fields **and** a discrete `indexes[]` entry named `${table}_${cols}_idx` (`defaultIndexName`).
- A FK whose columns are already covered by a declared index/unique/PK emits **no** synthesized index (dedup).
- `index: false` emits the FK constraint entry and **no** index entry.
- `constraint: false` emits **no** `foreignKeys[]` entry (only an `indexes[]` entry when `index: true`).
- A negative type check that the emitted `contract.d.ts` FK literal carries no `constraint`/`index`.

Assert by emitting and inspecting `contract.json` / the emitted `.d.ts` — never `typeof contract`. Cover Postgres and SQLite (the SQLite `renderForeignKeyClause` path).

**builds on:** — (the spec) · **hands to:** D2 — a red suite that is exactly the target behaviour · **focus:** emit-then-inspect; the spec's four edge cases.

## D2 — Materialize at emit; strip the booleans; delete the transient loop

**Outcome:** the persisted entity no longer carries the booleans, emit materializes the discrete entities, and D1 goes green in-package.

- Remove `constraint`/`index` from the `ForeignKey` IR node, `ForeignKeySchema` arktype, the `fk()` factory, and the `contract.d.ts` FK literal generator (`emitter/src/index.ts:625-635`).
- In the emit pipeline, materialize: drop the FK entity when `constraint` is false; append a `defaultIndexName`-named `indexes[]` entry when `index` is true and the columns aren't already backed — reusing `backingIndexColumnKeys`/`isBackedByColumnKeys` from `foreign-key-index-backing.ts`.
- Keep the authoring inputs feeding the materialization decision: PSL `@relation(index:)`, TS `fk({ constraint, index })` / `foreignKeyDefaults`, `applyFkDefaults`. They never reach `contract.json`.
- Delete the now-dead reconstruction: the `satisfiedIndexColumns` loop + the `constraint !== false` filter in `convertTable`, and the dead `if (!fk.constraint)` guard in the SQLite `renderForeignKeyClause`.
- Re-derive the one raw-boolean read in the Postgres backfill-strategy helper (`planner-strategies.ts:687-691`) from FK presence (a persisted `foreignKeys[]` entry now *is* a constraint).

**builds on:** D1's red suite · **hands to:** D3 — core logic green; `pnpm build` + `pnpm typecheck` clean for the touched packages; persisted contracts on disk still stale · **focus:** surgical substrate change, one outcome. Run per-package build/typecheck/unit-tests foreground.

## D3 — Repo-wide re-emit + full verification

**Outcome:** every FK-bearing contract is re-emitted and every suite is green.

- Re-emit the 14 FK-bearing `contract.json` + `contract.d.ts` (examples/, `packages/3-extensions/supabase`, `test/integration` fixtures) via each package's own emit/regen path — never hand-edit generated output.
- Confirm a second `contract emit` is byte-identical, and the ~32 FK-free contracts re-emit unchanged.
- Green: `pnpm build`, `pnpm typecheck --force`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check`, the full Lint job (incl. `lint:casts`, `check:upgrade-coverage`).

**builds on:** D2's core change · **hands to:** PR-open — slice-DoD met · **focus:** mechanical fan-out + comprehensive verification. Save each slow run to `wip/` and read the file.

## Orchestrator-authored (not dispatched)

- **Upgrade instructions.** FK1 changes the emitted contract shape (FK literal loses `constraint`/`index`; named backing-index entries appear) — a real breaking change for consumers reading `contract.json`/`contract.d.ts`, not incidental. Author a `changes[]` entry with detection in `skills/upgrade/prisma-next-upgrade/upgrades/0.14-to-0.15/instructions.md` myself (narrative doc), before D3's `check:upgrade-coverage` gate.
- **PR description** from the diff + this spec/plan.

## Review

After D3: opus reviewer pass (system-design + code review) before PR-open, per Drive build-slice. Adversarially check the materialization dedup and the `constraint:false`→absent-FK semantics against `db verify` (the differ must see an identical schema-IR tree pre/post — behaviour-neutral is the core claim to falsify).
