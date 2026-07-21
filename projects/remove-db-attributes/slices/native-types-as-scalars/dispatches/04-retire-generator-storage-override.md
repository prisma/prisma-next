# D4 — Retire the generator storage override (`@default` never mutates storage)

**Slice plan:** `projects/remove-db-attributes/slices/native-types-as-scalars/plan.md` · **Tier:** orchestrator · **Branch:** `tml-2986-native-types-as-scalars`

## Task

Operator-decided 2026-07-15: the type position is the **only** storage decider. Retire wholesale the machinery by which `@default(<generator>)` re-picks a column's storage:

- `generatedColumnDescriptor` + `resolveGeneratedColumnDescriptor` on the builtin generator metadata (`packages/1-framework/2-authoring/ids/src/index.ts`) and wherever the shape is threaded (`framework-components/src/shared/mutation-default-types.ts`, adapter `control-mutation-defaults.ts` files — grep both symbol names exhaustively).
- The override block in `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts` (~L510, `fieldUsesNamedType` exemption and all).
- The transitional `baseScalar` marker this slice's F-1 fix introduced (`framework-authoring.ts`, `ScalarTypeConstructorOutput`, `psl-column-resolution.ts`, adapters' contributions, all its tests) — it existed only to scope the override; it dies with it.

**Survives:** generator *applicability validation* (`applicableCodecIds` and whatever consumes it) — validating that `uuid()` can target a column's codec is legitimate; mutating the column is not. Also untouched: TS field presets (`field.id.uuidv4String()` et al. keep bundling `char(36)` explicitly — a preset's name is an explicit storage request); the F-1 QA report (historical record).

## Outcome (property statement)

A column's `{ codecId, nativeType, typeParams }` is a pure function of its type-position spelling (plus named-type indirection), **such that** `@default(...)` influences only default/execution-default semantics; `id String @default(uuid())` emits the target's `String` storage (pg: `pg/text@1`/`text`) with the uuidv4 execution default; `id Uuid @default(uuid())` emits `pg/uuid@1` (F-1's fix now holds by construction, not by flag); and a generator applied to a codec outside its `applicableCodecIds` still diagnoses.

## In

- Deletions above + their tests migrated to the new semantics: `String @default(uuid())` → text (pinned, both TS-parity and PSL sides); `String @default(nanoid())` / `cuid` cases likewise; applicability-diagnostic test survives (find or add one: a generator on an inapplicable codec, e.g. `Int @default(uuid())` — confirm actual diagnostic path first).
- TS↔PSL parity fixtures: preset spellings (`field.id.uuidv4String()` = char(36) + generator) re-pair with explicit PSL `Char(36) @default(uuid())`; parity cases that paired presets against `String @default(uuid())` update.
- Fixtures/examples: regenerate whatever legitimately changes (only columns whose PSL spelling was `String`-typed with a generator default); per-file justification in the report; drift anywhere else = halt.
- **Upgrade-instructions entry** (both clusters if both substrates diff, per `.agents/skills/record-upgrade-instructions/SKILL.md`): id `default-generators-no-longer-set-storage` — `String @default(uuid()/cuid()/nanoid())` columns now emit the target's String storage (postgres: text) instead of char(N); to keep prior storage author `Char(36)`/`Char(24)`/`Char(<size>)` (or adopt `Uuid` for uuid()); re-emit + migrate. Detection: glob `**/*.prisma`, contains `@default(uuid(`, `@default(cuid(`, `@default(nanoid(` — anyMatch.
- `pnpm check:upgrade-coverage` exit 0.

## Out

- TS preset surface changes. `@db.*` behavior. Anything in slices 3–4.

## Edge cases

| Case | Disposition |
| --- | --- |
| `applicableCodecIds` lists after retirement | Unchanged — but verify `pg/text@1` remains listed where `String` now stays text, so legacy schemas don't false-diagnose. |
| Named type `TId = String` + `@default(uuid())` | Same new rule: storage from the type chain (text); pin with a test. |
| Demo/e2e apps authored with `String @default(uuid())` | Their contracts change storage — regenerate + justify; if a committed migration chain would need rewriting beyond regeneration, HALT and report (slice-3 territory). |
| Destructive git ops / stash | Forbidden; `git commit -s`. |

## Completed when

1. `rg 'generatedColumnDescriptor|resolveGeneratedColumnDescriptor|baseScalar' packages --type ts` → zero hits (tests included; the QA report under `projects/` is exempt).
2. New-semantics pins green; applicability diagnostic test green; TS↔PSL parity green re-paired.
3. `pnpm typecheck`, per-touched-package lint + tests, `pnpm fixtures:check` clean (justified regens only), `pnpm lint:deps`, `pnpm check:upgrade-coverage` exit 0.

## Report back

Everything deleted (by symbol); new-semantics test names; fixture/example regens with per-file justification; upgrade entry; gates + results; F1/F12/F13/F14 checked; commit SHA.
